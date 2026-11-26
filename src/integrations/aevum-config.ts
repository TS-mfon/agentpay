import { defineChain, parseAbi } from "viem";
export const AEVUM_CHAIN_ID = 44005;
export { TUSD8_ADDRESS } from "../core/types";
export const TOKEN_DECIMALS = 6;
export const aevum = defineChain({
  id: AEVUM_CHAIN_ID,
  name: "QDay Aevum Testnet",
  nativeCurrency: { name: "Test QDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc-test.qday.info"] } },
  blockExplorers: {
    default: { name: "Aevum Explorer", url: "https://explorer-test.qday.info" },
  },
  testnet: true,
});
export const vaultAbi = parseAbi([
  "constructor(address tokenAddress, address initialOwner, address initialExecutor)",
  "function token() view returns (address)",
  "function owner() view returns (address)",
  "function executor() view returns (address)",
  "function paused() view returns (bool)",
  "function authorizationEpoch() view returns (uint256)",
  "function agentAuthorizationEpoch(bytes32) view returns (uint256)",
  "function executed(bytes32) view returns (bool)",
  "function agentConfig(bytes32) view returns (uint256 policyVersion, bytes32 mandateHash, uint256 perPaymentLimit, uint256 weeklyBudget, uint256 totalBudget, uint256 validUntil, bool active)",
  "function isAgentActive(bytes32) view returns (bool)",
  "function isRecipientAllowed(bytes32,address) view returns (bool)",
  "function availableBudgets(bytes32) view returns (uint256 weekly, uint256 total)",
  "function spentBudgets(bytes32) view returns (uint256 week, uint256 weekly, uint256 total)",
  "function executePayment(bytes32 requestId, bytes32 agentId, uint256 policyVersion, address recipient, uint256 amount, uint256 approvalExpiresAt, bytes32 requestHash, bytes32 decisionRef)",
  "function configureAgent(bytes32 agentId, uint256 policyVersion, bytes32 mandateHash, uint256 perPaymentLimit, uint256 weeklyBudget, uint256 totalBudget, uint256 validUntil, address[] recipients)",
  "function setPaused(bool value)",
  "function revokeAgent(bytes32 agentId)",
  "function withdraw(address recipient, uint256 amount)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  "event AgentConfigured(bytes32 indexed agentId, uint256 indexed policyVersion, bytes32 mandateHash, uint256 perPaymentLimit, uint256 weeklyBudget, uint256 totalBudget, uint256 validUntil, uint256 authorizationEpoch, address[] recipients)",
  "event AgentRevoked(bytes32 indexed agentId, uint256 indexed policyVersion)",
  "event PauseChanged(bool paused, uint256 authorizationEpoch)",
  "event Withdrawn(address indexed recipient, uint256 amount)",
  "event PaymentExecuted(bytes32 indexed requestId, bytes32 indexed agentId, uint256 indexed policyVersion, address recipient, uint256 amount, bytes32 requestHash, bytes32 decisionRef, uint256 authorizationEpoch)",
]);
