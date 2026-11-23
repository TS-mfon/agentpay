// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Owner-funded vault with independent deterministic financial limits.
/// @dev The executor is trusted to attest to finalized external policy decisions.
contract AgentTreasury is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant WEEK_SECONDS = 7 days;
    uint256 public constant MAX_RECIPIENTS = 64;
    IERC20 public immutable token;
    address public executor;
    bool public paused;
    uint256 public authorizationEpoch;

    struct AgentConfig {
        uint256 policyVersion;
        bytes32 mandateHash;
        uint256 perPaymentLimit;
        uint256 weeklyBudget;
        uint256 totalBudget;
        uint256 validUntil;
        bool active;
    }

    struct Spending {
        uint256 week;
        uint256 weeklySpent;
        uint256 totalSpent;
    }

    mapping(bytes32 => AgentConfig) public agentConfig;
    mapping(bytes32 => bool) public executed;
    mapping(bytes32 => uint256) public agentAuthorizationEpoch;
    mapping(bytes32 => Spending) private spending;
    mapping(bytes32 => mapping(uint256 => mapping(address => bool))) private approvedRecipients;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidReference();
    error InvalidLimits();
    error InvalidPolicyVersion();
    error InvalidAgentExpiry();
    error InvalidRecipientCount();
    error BudgetBelowSpent();
    error UnauthorizedExecutor();
    error TreasuryPaused();
    error AgentInactive();
    error PolicyVersionMismatch();
    error RecipientNotAllowed();
    error ApprovalExpired();
    error InvalidApprovalExpiry();
    error AlreadyExecuted();
    error PaymentLimitExceeded();
    error WeeklyBudgetExceeded();
    error TotalBudgetExceeded();
    error InsufficientBalance();
    error OwnershipRenunciationDisabled();

    event AgentConfigured(
        bytes32 indexed agentId, uint256 indexed policyVersion, bytes32 mandateHash,
        uint256 perPaymentLimit, uint256 weeklyBudget, uint256 totalBudget,
        uint256 validUntil, uint256 authorizationEpoch, address[] recipients
    );
    event AgentRevoked(bytes32 indexed agentId, uint256 indexed policyVersion);
    event PauseChanged(bool paused, uint256 authorizationEpoch);
    event ExecutorChanged(address indexed previousExecutor, address indexed executor);
    event Withdrawn(address indexed recipient, uint256 amount);
    event PaymentExecuted(
        bytes32 indexed requestId, bytes32 indexed agentId, uint256 indexed policyVersion,
        address recipient, uint256 amount, bytes32 requestHash, bytes32 decisionRef,
        uint256 authorizationEpoch
    );

    constructor(address tokenAddress, address initialOwner, address initialExecutor) Ownable(initialOwner) {
        if (tokenAddress == address(0) || tokenAddress.code.length == 0 || initialExecutor == address(0)) {
            revert InvalidAddress();
        }
        token = IERC20(tokenAddress);
        executor = initialExecutor;
    }

    function configureAgent(
        bytes32 agentId, uint256 policyVersion, bytes32 mandateHash,
        uint256 perPaymentLimit, uint256 weeklyBudget, uint256 totalBudget,
        uint256 validUntil, address[] calldata recipients
    ) external onlyOwner nonReentrant {
        if (agentId == bytes32(0) || mandateHash == bytes32(0)) revert InvalidReference();
        if (policyVersion <= agentConfig[agentId].policyVersion) revert InvalidPolicyVersion();
        if (validUntil <= block.timestamp) revert InvalidAgentExpiry();
        _validateLimits(agentId, perPaymentLimit, weeklyBudget, totalBudget);
        if (recipients.length == 0 || recipients.length > MAX_RECIPIENTS) revert InvalidRecipientCount();
        for (uint256 i; i < recipients.length; i++) {
            if (recipients[i] == address(0) || recipients[i] == address(this)) revert InvalidAddress();
            approvedRecipients[agentId][policyVersion][recipients[i]] = true;
        }
        agentConfig[agentId] = AgentConfig(
            policyVersion, mandateHash, perPaymentLimit, weeklyBudget, totalBudget, validUntil, true
        );
        agentAuthorizationEpoch[agentId] = authorizationEpoch;
        emit AgentConfigured(agentId, policyVersion, mandateHash, perPaymentLimit,
            weeklyBudget, totalBudget, validUntil, authorizationEpoch, recipients);
    }

    function revokeAgent(bytes32 agentId) external onlyOwner nonReentrant {
        AgentConfig memory config = agentConfig[agentId];
        if (config.policyVersion == 0) revert AgentInactive();
        agentConfig[agentId] = AgentConfig(config.policyVersion, config.mandateHash, config.perPaymentLimit,
            config.weeklyBudget, config.totalBudget, config.validUntil, false);
        emit AgentRevoked(agentId, config.policyVersion);
    }

    /// @notice Pausing permanently invalidates prior agent configurations.
    /// @dev Resume requires configuring each agent with a higher policy version.
    function setPaused(bool value) external onlyOwner nonReentrant {
        if (value && !paused) authorizationEpoch += 1;
        paused = value;
        emit PauseChanged(value, authorizationEpoch);
    }

    function setExecutor(address nextExecutor) external onlyOwner nonReentrant {
        if (nextExecutor == address(0)) revert InvalidAddress();
        address previous = executor;
        executor = nextExecutor;
        emit ExecutorChanged(previous, nextExecutor);
    }

    /// @notice Unused deposited funds remain recoverable while the vault is paused.
    function withdraw(address recipient, uint256 amount) external onlyOwner nonReentrant {
        if (recipient == address(0) || recipient == address(this)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (amount > token.balanceOf(address(this))) revert InsufficientBalance();
        token.safeTransfer(recipient, amount);
        emit Withdrawn(recipient, amount);
    }

    function executePayment(
        bytes32 requestId, bytes32 agentId, uint256 policyVersion, address recipient,
        uint256 amount, uint256 approvalExpiresAt, bytes32 requestHash, bytes32 decisionRef
    ) external nonReentrant {
        if (msg.sender != executor) revert UnauthorizedExecutor();
        if (paused) revert TreasuryPaused();
        if (requestId == bytes32(0) || requestHash == bytes32(0) || decisionRef == bytes32(0)) {
            revert InvalidReference();
        }
        if (executed[requestId]) revert AlreadyExecuted();
        AgentConfig memory config = agentConfig[agentId];
        _validatePayment(agentId, config, policyVersion, recipient, amount, approvalExpiresAt);
        executed[requestId] = true;
        spending[agentId] = Spending(currentWeek(), _weeklySpent(agentId) + amount,
            spending[agentId].totalSpent + amount);
        token.safeTransfer(recipient, amount);
        emit PaymentExecuted(requestId, agentId, policyVersion, recipient, amount,
            requestHash, decisionRef, authorizationEpoch);
    }

    function _validatePayment(
        bytes32 agentId, AgentConfig memory config, uint256 policyVersion,
        address recipient, uint256 amount, uint256 approvalExpiresAt
    ) private view {
        if (!isAgentActive(agentId)) revert AgentInactive();
        if (policyVersion != config.policyVersion) revert PolicyVersionMismatch();
        if (!approvedRecipients[agentId][policyVersion][recipient]) revert RecipientNotAllowed();
        if (amount == 0) revert InvalidAmount();
        if (approvalExpiresAt <= block.timestamp) revert ApprovalExpired();
        if (approvalExpiresAt > config.validUntil) revert InvalidApprovalExpiry();
        if (amount > config.perPaymentLimit) revert PaymentLimitExceeded();
        if (amount > config.weeklyBudget - _weeklySpent(agentId)) revert WeeklyBudgetExceeded();
        if (amount > config.totalBudget - spending[agentId].totalSpent) revert TotalBudgetExceeded();
        if (amount > token.balanceOf(address(this))) revert InsufficientBalance();
    }

    function _validateLimits(bytes32 agentId, uint256 cap, uint256 weekly, uint256 total) private view {
        if (cap == 0 || weekly == 0 || total == 0 || cap > weekly || cap > total) revert InvalidLimits();
        if (weekly < _weeklySpent(agentId) || total < spending[agentId].totalSpent) revert BudgetBelowSpent();
    }

    function currentWeek() public view returns (uint256) { return block.timestamp / WEEK_SECONDS; }

    function isAgentActive(bytes32 agentId) public view returns (bool) {
        AgentConfig memory config = agentConfig[agentId];
        return !paused && config.active && config.validUntil > block.timestamp
            && agentAuthorizationEpoch[agentId] == authorizationEpoch;
    }

    function isRecipientAllowed(bytes32 agentId, address recipient) external view returns (bool) {
        return approvedRecipients[agentId][agentConfig[agentId].policyVersion][recipient];
    }

    function availableBudgets(bytes32 agentId) external view returns (uint256 weekly, uint256 total) {
        if (!isAgentActive(agentId)) return (0, 0);
        AgentConfig memory config = agentConfig[agentId];
        return (config.weeklyBudget - _weeklySpent(agentId), config.totalBudget - spending[agentId].totalSpent);
    }

    function spentBudgets(bytes32 agentId) external view returns (uint256 week, uint256 weekly, uint256 total) {
        return (currentWeek(), _weeklySpent(agentId), spending[agentId].totalSpent);
    }

    function _weeklySpent(bytes32 agentId) private view returns (uint256) {
        return spending[agentId].week == currentWeek() ? spending[agentId].weeklySpent : 0;
    }

    /// @notice Prevent accidentally abandoning the only account able to recover funds.
    function renounceOwnership() public view override onlyOwner {
        revert OwnershipRenunciationDisabled();
    }
}
