import {
  BaseError, encodeDeployData, getAbiItem, getContractAddress, isAddress, isAddressEqual, keccak256,
  TransactionReceiptNotFoundError, UserRejectedRequestError, zeroAddress,
  type Address, type DeployContractParameters, type Hash, type Hex, type PublicClient,
  type TransactionReceipt,
} from "viem";
import { aevum, TUSD8_ADDRESS, vaultAbi } from "../integrations/aevum-config";

const ownershipTransferred = getAbiItem({ abi: vaultAbi, name: "OwnershipTransferred" });
const blocksPerQuery = 1_000n;
const scanQueriesPerAttempt = 4;
const overlap = 16n;
const receiptTimeout = 30_000;

type Deployment = {
  rpc: Pick<PublicClient, "getBlockNumber" | "getChainId" | "getCode" | "getLogs" | "getTransaction" |
    "getTransactionCount" | "getTransactionReceipt" | "readContract" | "waitForTransactionReceipt">;
  wallet: { deployContract(args: DeployContractParameters<typeof vaultAbi, typeof aevum>): Promise<Hash> };
  signer: Address;
  owner: Address;
  vaultBytecode: Hex;
  executor: Address;
};

type Reservation = {
  nonce: number;
  fromBlock: string;
  scanFrom: string;
  predicted: Address;
  initHash: Hash;
  hash?: Hash;
  confirmed?: true;
};

function isHash(value: unknown): value is Hash {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function reservationKey(signer: Address) {
  return `agentpay:treasury-deployment:${aevum.id}:${signer.toLowerCase()}`;
}

function readReservation(key: string): Reservation | undefined {
  const saved = localStorage.getItem(key);
  if (saved === null) return undefined;
  try {
    const value = JSON.parse(saved) as Reservation;
    if (Number.isSafeInteger(value.nonce) && value.nonce >= 0 &&
      typeof value.fromBlock === "string" && /^\d+$/.test(value.fromBlock) &&
      typeof value.scanFrom === "string" && /^\d+$/.test(value.scanFrom) &&
      BigInt(value.scanFrom) >= BigInt(value.fromBlock) &&
      typeof value.predicted === "string" && isAddress(value.predicted) && isHash(value.initHash) &&
      (value.hash === undefined || isHash(value.hash)) &&
      (value.confirmed === undefined || (value.confirmed === true && value.hash))) {
      return value;
    }
  } catch { /* Keep an unreadable pending reservation in place. */ }
  throw new Error("The saved treasury deployment could not be read. Check your earlier deployment in your wallet.");
}

function saveReservation(key: string, reservation: Reservation) {
  localStorage.setItem(key, JSON.stringify(reservation));
  return reservation;
}

function withDeploymentLock<T>(signer: Address, action: (key: string) => Promise<T>) {
  if (!globalThis.navigator?.locks) {
    throw new Error("Use a browser with Web Locks support to create a treasury safely.");
  }
  const key = reservationKey(signer);
  return navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("This wallet already has a treasury deployment running in another tab.");
    return action(key);
  });
}

function userRejected(error: unknown) {
  return error instanceof UserRejectedRequestError ||
    (error instanceof BaseError && error.walk(cause => cause instanceof UserRejectedRequestError) instanceof UserRejectedRequestError);
}

function pending(reason?: unknown) {
  return new Error("Treasury deployment is pending confirmation. Retry to recover it with the same wallet.", { cause: reason });
}

async function verifyReceipt(input: Deployment, reservation: Reservation, receipt: TransactionReceipt, key: string) {
  const { rpc, signer, owner, executor } = input;
  const { predicted, initHash, nonce, hash } = reservation;
  const tx = await rpc.getTransaction({ hash: receipt.transactionHash });
  if (receipt.transactionHash !== hash || tx.hash !== hash || !isAddressEqual(tx.from, signer) ||
    tx.to !== null || tx.value !== 0n || tx.nonce !== nonce || keccak256(tx.input) !== initHash ||
    tx.blockHash !== receipt.blockHash || tx.blockNumber !== receipt.blockNumber ||
    receipt.blockNumber < BigInt(reservation.fromBlock)) {
    throw new Error("The confirmed transaction does not match this treasury deployment. Check the transaction in your wallet.");
  }
  if (receipt.status === "reverted") {
    localStorage.removeItem(key);
    throw new Error("The treasury deployment reverted on Aevum. You can retry with a new transaction.");
  }
  if (receipt.status !== "success" || !receipt.contractAddress || !isAddressEqual(receipt.contractAddress, predicted)) {
    throw new Error("Aevum did not confirm the expected treasury address.");
  }
  const blockNumber = await rpc.getBlockNumber({ cacheTime: 0 });
  const target = { address: predicted, abi: vaultAbi, blockNumber } as const;
  const [code, vaultOwner, token, vaultExecutor] = await Promise.all([
    rpc.getCode({ address: predicted, blockNumber }),
    rpc.readContract({ ...target, functionName: "owner" }),
    rpc.readContract({ ...target, functionName: "token" }),
    rpc.readContract({ ...target, functionName: "executor" }),
  ]);
  if (!code || code === "0x" || !isAddressEqual(vaultOwner, owner) ||
    !isAddressEqual(token, TUSD8_ADDRESS) || !isAddressEqual(vaultExecutor, executor)) {
    throw new Error("The deployed treasury has different ownership, token, or executor settings.");
  }
  saveReservation(key, { ...reservation, confirmed: true });
  return predicted;
}

async function receiptFor(rpc: Deployment["rpc"], hash: Hash) {
  try { return await rpc.getTransactionReceipt({ hash }); }
  catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) return undefined;
    throw error;
  }
}

async function recover(input: Deployment, reservation: Reservation, key: string) {
  const { rpc, owner, signer } = input;
  if (reservation.hash) {
    const receipt = await receiptFor(rpc, reservation.hash);
    if (receipt) return verifyReceipt(input, reservation, receipt, key);
  }
  const head = await rpc.getBlockNumber({ cacheTime: 0 });
  const confirmedNonce = await rpc.getTransactionCount({ address: signer, blockNumber: head });
  if (!reservation.hash && confirmedNonce <= reservation.nonce &&
    await rpc.getTransactionCount({ address: signer, blockTag: "pending" }) === reservation.nonce) {
    // User retried setup. The identical CREATE at the reserved nonce can only be included once.
    return submitDeployment(input, reservation, key, true);
  }
  if (confirmedNonce <= reservation.nonce) throw pending();
  let fromBlock = BigInt(reservation.scanFrom);
  for (let page = 0; page < scanQueriesPerAttempt && fromBlock <= head; page++) {
    const last = fromBlock + blocksPerQuery - 1n;
    const toBlock = last < head ? last : head;
    const logs = await rpc.getLogs({ address: reservation.predicted, event: ownershipTransferred,
      args: { previousOwner: zeroAddress, newOwner: owner }, fromBlock, toBlock, strict: true });
    const candidate = logs.find((log) => !log.removed && isHash(log.transactionHash));
    if (candidate?.transactionHash) {
      const withHash = saveReservation(key, { ...reservation, hash: candidate.transactionHash });
      const receipt = await receiptFor(rpc, candidate.transactionHash);
      if (!receipt) throw pending();
      return verifyReceipt(input, withHash, receipt, key);
    }
    const next = toBlock + 1n;
    const scanFrom = next < head - overlap ? next : head - overlap;
    if (scanFrom > fromBlock) saveReservation(key, { ...reservation, scanFrom: scanFrom.toString() });
    fromBlock = next;
  }
  throw pending();
}

async function submitDeployment(input: Deployment, reservation: Reservation, key: string, retry: boolean) {
  const { rpc, wallet, signer, owner, vaultBytecode, executor } = input;
  let hash: Hash;
  try {
    hash = await wallet.deployContract({ account: signer, chain: aevum, abi: vaultAbi,
      args: [TUSD8_ADDRESS, owner, executor], bytecode: vaultBytecode, nonce: reservation.nonce, value: 0n });
  } catch (error) {
    if (!userRejected(error) || retry) throw pending(error);
    const currentNonce = await rpc.getTransactionCount({ address: signer, blockTag: "pending" });
    if (currentNonce !== reservation.nonce) throw pending(error);
    localStorage.removeItem(key);
    throw error;
  }
  if (!isHash(hash)) throw pending();
  const submitted = saveReservation(key, { ...reservation, hash });
  let receipt: TransactionReceipt;
  try { receipt = await rpc.waitForTransactionReceipt({ hash, timeout: receiptTimeout, checkReplacement: false }); }
  catch (error) { throw pending(error); }
  return verifyReceipt(input, submitted, receipt, key);
}

export async function deploySmartAccountVault(input: Deployment): Promise<Address> {
  const { rpc, signer, owner, vaultBytecode, executor } = input;
  return withDeploymentLock(signer, async (key) => {
    if (await rpc.getChainId() !== aevum.id) throw new Error("Connect to QDay Aevum Testnet before creating a treasury.");
    const args = [TUSD8_ADDRESS, owner, executor] as const;
    const initHash = keccak256(encodeDeployData({ abi: vaultAbi, bytecode: vaultBytecode, args }));
    const saved = readReservation(key);
    if (saved) {
      if (saved.initHash !== initHash || !isAddressEqual(saved.predicted, getContractAddress({ from: signer, nonce: BigInt(saved.nonce) }))) {
        throw new Error("A different treasury deployment is reserved for this wallet. Retry the previous setup first.");
      }
      return recover(input, saved, key);
    }
    const fromBlock = (await rpc.getBlockNumber({ cacheTime: 0 })).toString();
    const nonce = await rpc.getTransactionCount({ address: signer, blockTag: "pending" });
    const reservation = saveReservation(key, { nonce, fromBlock, scanFrom: fromBlock, initHash,
      predicted: getContractAddress({ from: signer, nonce: BigInt(nonce) }) });
    return submitDeployment(input, reservation, key, false);
  });
}

export async function clearSmartAccountVaultDeployment(signer: Address, vault: Address) {
  await withDeploymentLock(signer, async (key) => {
    const saved = readReservation(key);
    if (saved?.confirmed && isAddressEqual(saved.predicted, vault)) localStorage.removeItem(key);
  });
}
