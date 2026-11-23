// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AgentTreasury} from "../src/AgentTreasury.sol";
import {TestSupport, MockToken, Vm} from "./TestSupport.sol";

contract AgentTreasuryTest is TestSupport {
    MockToken internal token;
    AgentTreasury internal vault;
    address internal constant EXECUTOR = address(0xE1);
    address internal constant MERCHANT = address(0xA1);
    address internal constant STRANGER = address(0xB1);
    bytes32 internal constant AGENT = keccak256("research-agent");
    bytes32 internal constant MANDATE = keccak256("research only");
    uint256 internal constant UNIT = 1e6;
    uint256 internal expires;

    function setUp() public {
        vm.warp(10 * 7 days + 1 days);
        expires = block.timestamp + 30 days;
        token = new MockToken();
        vault = new AgentTreasury(address(token), address(this), EXECUTOR);
        token.mint(address(vault), 200 * UNIT);
        _configure(1, 10 * UNIT, 40 * UNIT, 100 * UNIT, MERCHANT);
    }

    function _configure(uint256 version, uint256 cap, uint256 weekly, uint256 total, address merchant) internal {
        address[] memory recipients = new address[](1);
        recipients[0] = merchant;
        vault.configureAgent(AGENT, version, MANDATE, cap, weekly, total, expires, recipients);
    }

    function _pay(bytes32 requestId, uint256 version, address merchant, uint256 amount, uint256 deadline) internal {
        vm.prank(EXECUTOR);
        vault.executePayment(requestId, AGENT, version, merchant, amount, deadline,
            keccak256(abi.encode(requestId, amount)), keccak256("genlayer-finalized-decision"));
    }

    function testSettlementRecordsReplayAndBudgets() public {
        bytes32 id = keccak256("payment-1");
        _pay(id, 1, MERCHANT, 8 * UNIT, block.timestamp + 1 hours);
        assertTrue(vault.executed(id));
        assertEq(token.balanceOf(MERCHANT), 8 * UNIT);
        (uint256 weekly, uint256 total) = vault.availableBudgets(AGENT);
        assertEq(weekly, 32 * UNIT);
        assertEq(total, 92 * UNIT);
    }

    function testReceiptBindsRequestDecisionAndPolicy() public {
        bytes32 id = keccak256("receipt");
        vm.recordLogs();
        _pay(id, 1, MERCHANT, 8 * UNIT, block.timestamp + 1 hours);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertEq(uint160(logs[0].emitter), uint160(address(vault)));
        assertTrue(logs[0].topics[1] == id);
        assertTrue(logs[0].topics[2] == AGENT);
        assertEq(uint256(logs[0].topics[3]), 1);
        (address recipient, uint256 amount, bytes32 requestHash, bytes32 decisionRef, uint256 epoch) =
            abi.decode(logs[0].data, (address, uint256, bytes32, bytes32, uint256));
        assertEq(uint160(recipient), uint160(MERCHANT));
        assertEq(amount, 8 * UNIT);
        assertTrue(requestHash == keccak256(abi.encode(id, amount)));
        assertTrue(decisionRef == keccak256("genlayer-finalized-decision"));
        assertEq(epoch, 0);
    }

    function testExecutorOnly() public {
        vm.prank(STRANGER);
        vm.expectRevert(AgentTreasury.UnauthorizedExecutor.selector);
        vault.executePayment(keccak256("x"), AGENT, 1, MERCHANT, UNIT,
            block.timestamp + 1 hours, MANDATE, MANDATE);
    }

    function testReplayRejected() public {
        bytes32 id = keccak256("duplicate");
        _pay(id, 1, MERCHANT, UNIT, block.timestamp + 1 hours);
        vm.expectRevert(AgentTreasury.AlreadyExecuted.selector);
        _pay(id, 1, MERCHANT, UNIT, block.timestamp + 1 hours);
    }

    function testPerPaymentLimitEnforced() public {
        vm.expectRevert(AgentTreasury.PaymentLimitExceeded.selector);
        _pay(keccak256("large"), 1, MERCHANT, 10 * UNIT + 1, block.timestamp + 1 hours);
    }

    function testWeeklyLimitEnforced() public {
        for (uint256 i; i < 4; i++) _pay(bytes32(i + 1), 1, MERCHANT, 10 * UNIT, block.timestamp + 1 hours);
        vm.expectRevert(AgentTreasury.WeeklyBudgetExceeded.selector);
        _pay(bytes32(uint256(5)), 1, MERCHANT, 1, block.timestamp + 1 hours);
    }

    function testWeeklyBoundaryResetsWeeklyButNotTotal() public {
        _pay(bytes32(uint256(1)), 1, MERCHANT, 10 * UNIT, block.timestamp + 1 hours);
        vm.warp(11 * 7 days);
        (uint256 weekly, uint256 total) = vault.availableBudgets(AGENT);
        assertEq(weekly, 40 * UNIT);
        assertEq(total, 90 * UNIT);
    }

    function testSettlingAcrossWeeksPreservesLifetimeSpend() public {
        _pay(bytes32(uint256(1)), 1, MERCHANT, 8 * UNIT, block.timestamp + 1 hours);
        vm.warp(11 * 7 days);
        _pay(bytes32(uint256(2)), 1, MERCHANT, 7 * UNIT, 11 * 7 days + 1 hours);
        (uint256 week, uint256 weekly, uint256 total) = vault.spentBudgets(AGENT);
        assertEq(week, 11); assertEq(weekly, 7 * UNIT); assertEq(total, 15 * UNIT);
        (uint256 weeklyRemaining, uint256 totalRemaining) = vault.availableBudgets(AGENT);
        assertEq(weeklyRemaining, 33 * UNIT); assertEq(totalRemaining, 85 * UNIT);
    }

    function testTotalBudgetSpansWeeks() public {
        _configure(2, 10 * UNIT, 40 * UNIT, 15 * UNIT, MERCHANT);
        _pay(bytes32(uint256(1)), 2, MERCHANT, 10 * UNIT, block.timestamp + 1 hours);
        vm.warp(11 * 7 days);
        vm.expectRevert(AgentTreasury.TotalBudgetExceeded.selector);
        _pay(bytes32(uint256(2)), 2, MERCHANT, 6 * UNIT, 11 * 7 days + 1 hours);
    }

    function testPolicyUpdateDoesNotResetSpend() public {
        _pay(bytes32(uint256(1)), 1, MERCHANT, 8 * UNIT, block.timestamp + 1 hours);
        _configure(2, 10 * UNIT, 40 * UNIT, 100 * UNIT, MERCHANT);
        (uint256 weekly, uint256 total) = vault.availableBudgets(AGENT);
        assertEq(weekly, 32 * UNIT);
        assertEq(total, 92 * UNIT);
    }

    function testBudgetCannotShrinkBelowSettledSpend() public {
        _pay(bytes32(uint256(1)), 1, MERCHANT, 8 * UNIT, block.timestamp + 1 hours);
        vm.expectRevert(AgentTreasury.BudgetBelowSpent.selector);
        _configure(2, UNIT, 7 * UNIT, 100 * UNIT, MERCHANT);
        vm.expectRevert(AgentTreasury.BudgetBelowSpent.selector);
        _configure(2, UNIT, 40 * UNIT, 7 * UNIT, MERCHANT);
    }

    function testOldPolicyAndOldRecipientsInvalidated() public {
        _configure(2, 10 * UNIT, 40 * UNIT, 100 * UNIT, STRANGER);
        assertFalse(vault.isRecipientAllowed(AGENT, MERCHANT));
        assertTrue(vault.isRecipientAllowed(AGENT, STRANGER));
        vm.expectRevert(AgentTreasury.PolicyVersionMismatch.selector);
        _pay(bytes32(uint256(1)), 1, STRANGER, UNIT, block.timestamp + 1 hours);
        vm.expectRevert(AgentTreasury.RecipientNotAllowed.selector);
        _pay(bytes32(uint256(2)), 2, MERCHANT, UNIT, block.timestamp + 1 hours);
    }

    function testVersionMustStrictlyIncrease() public {
        vm.expectRevert(AgentTreasury.InvalidPolicyVersion.selector);
        _configure(1, 10 * UNIT, 40 * UNIT, 100 * UNIT, MERCHANT);
    }

    function testApprovalExpiryEnforced() public {
        vm.expectRevert(AgentTreasury.ApprovalExpired.selector);
        _pay(bytes32(uint256(1)), 1, MERCHANT, UNIT, block.timestamp);
        vm.expectRevert(AgentTreasury.InvalidApprovalExpiry.selector);
        _pay(bytes32(uint256(2)), 1, MERCHANT, UNIT, expires + 1);
    }

    function testAgentExpiryEnforced() public {
        vm.warp(expires);
        vm.expectRevert(AgentTreasury.AgentInactive.selector);
        _pay(bytes32(uint256(1)), 1, MERCHANT, UNIT, expires);
    }

    function testPauseBlocksPaymentButOwnerCanWithdraw() public {
        vault.setPaused(true);
        vm.expectRevert(AgentTreasury.TreasuryPaused.selector);
        _pay(bytes32(uint256(1)), 1, MERCHANT, UNIT, block.timestamp + 1 hours);
        vault.withdraw(address(this), 50 * UNIT);
        assertEq(token.balanceOf(address(this)), 50 * UNIT);
    }

    function testPauseInvalidatesApprovalsEvenAfterResume() public {
        vault.setPaused(true);
        assertEq(vault.authorizationEpoch(), 1);
        vault.setPaused(false);
        assertFalse(vault.isAgentActive(AGENT));
        vm.expectRevert(AgentTreasury.AgentInactive.selector);
        _pay(bytes32(uint256(1)), 1, MERCHANT, UNIT, block.timestamp + 1 hours);
        _configure(2, 10 * UNIT, 40 * UNIT, 100 * UNIT, MERCHANT);
        assertTrue(vault.isAgentActive(AGENT));
        _pay(bytes32(uint256(1)), 2, MERCHANT, UNIT, block.timestamp + 1 hours);
    }

    function testOwnershipCannotBeAbandoned() public {
        vm.expectRevert(AgentTreasury.OwnershipRenunciationDisabled.selector);
        vault.renounceOwnership();
    }

    function testRevocationBlocksPendingPayment() public {
        vault.revokeAgent(AGENT);
        vm.expectRevert(AgentTreasury.AgentInactive.selector);
        _pay(bytes32(uint256(1)), 1, MERCHANT, UNIT, block.timestamp + 1 hours);
    }

    function testExecutorRotationInvalidatesOldExecutor() public {
        vault.setExecutor(STRANGER);
        vm.expectRevert(AgentTreasury.UnauthorizedExecutor.selector);
        _pay(bytes32(uint256(1)), 1, MERCHANT, UNIT, block.timestamp + 1 hours);
        vm.prank(STRANGER);
        vault.executePayment(bytes32(uint256(2)), AGENT, 1, MERCHANT, UNIT,
            block.timestamp + 1 hours, MANDATE, MANDATE);
        assertEq(token.balanceOf(MERCHANT), UNIT);
    }

    function testExecutorCannotAdministerOrWithdraw() public {
        vm.prank(EXECUTOR); vm.expectRevert(); vault.withdraw(EXECUTOR, UNIT);
        vm.prank(EXECUTOR); vm.expectRevert(); vault.setPaused(true);
        vm.prank(EXECUTOR); vm.expectRevert(); vault.setExecutor(EXECUTOR);
        vm.prank(EXECUTOR); vm.expectRevert(); vault.revokeAgent(AGENT);
        vm.prank(EXECUTOR); vm.expectRevert();
        _configure(2, 10 * UNIT, 40 * UNIT, 100 * UNIT, MERCHANT);
    }

    function testWithdrawalDoesNotResetBudget() public {
        _pay(bytes32(uint256(1)), 1, MERCHANT, UNIT, block.timestamp + 1 hours);
        vault.withdraw(address(this), 199 * UNIT);
        (uint256 weekly, uint256 total) = vault.availableBudgets(AGENT);
        assertEq(weekly, 39 * UNIT); assertEq(total, 99 * UNIT);
        vm.expectRevert(AgentTreasury.InsufficientBalance.selector);
        _pay(bytes32(uint256(2)), 1, MERCHANT, UNIT, block.timestamp + 1 hours);
    }

    function testTransferFailureRollsBackReplayAndAccounting() public {
        bytes32 id = keccak256("failing-transfer");
        token.setFailTransfers(true);
        vm.expectRevert(); _pay(id, 1, MERCHANT, UNIT, block.timestamp + 1 hours);
        assertFalse(vault.executed(id));
        (uint256 weekly, uint256 total) = vault.availableBudgets(AGENT);
        assertEq(weekly, 40 * UNIT); assertEq(total, 100 * UNIT);
        token.setFailTransfers(false);
        _pay(id, 1, MERCHANT, UNIT, block.timestamp + 1 hours);
        assertTrue(vault.executed(id));
    }

    function testZeroPaymentAndZeroReferencesRejected() public {
        vm.expectRevert(AgentTreasury.InvalidAmount.selector);
        _pay(bytes32(uint256(1)), 1, MERCHANT, 0, block.timestamp + 1 hours);
        vm.expectRevert(AgentTreasury.InvalidReference.selector);
        _pay(bytes32(0), 1, MERCHANT, UNIT, block.timestamp + 1 hours);
        vm.prank(EXECUTOR); vm.expectRevert(AgentTreasury.InvalidReference.selector);
        vault.executePayment(bytes32(uint256(2)), AGENT, 1, MERCHANT, UNIT,
            block.timestamp + 1 hours, bytes32(0), MANDATE);
        vm.prank(EXECUTOR); vm.expectRevert(AgentTreasury.InvalidReference.selector);
        vault.executePayment(bytes32(uint256(3)), AGENT, 1, MERCHANT, UNIT,
            block.timestamp + 1 hours, MANDATE, bytes32(0));
    }

    function testInvalidWithdrawalArguments() public {
        vm.expectRevert(AgentTreasury.InvalidAddress.selector);
        vault.withdraw(address(0), UNIT);
        vm.expectRevert(AgentTreasury.InvalidAddress.selector);
        vault.withdraw(address(vault), UNIT);
        vm.expectRevert(AgentTreasury.InvalidAmount.selector);
        vault.withdraw(address(this), 0);
        vm.expectRevert(AgentTreasury.InsufficientBalance.selector);
        vault.withdraw(address(this), 201 * UNIT);
    }

    function testRepeatedPauseDoesNotIncrementEpoch() public {
        vault.setPaused(true);
        vault.setPaused(true);
        assertEq(vault.authorizationEpoch(), 1);
        vault.setPaused(false);
        vault.setPaused(true);
        assertEq(vault.authorizationEpoch(), 2);
        (uint256 weekly, uint256 total) = vault.availableBudgets(AGENT);
        assertEq(weekly, 0); assertEq(total, 0);
    }

    function testUnknownAgentHasNoAuthority() public {
        bytes32 unknown = keccak256("unknown");
        assertFalse(vault.isAgentActive(unknown));
        (uint256 weekly, uint256 total) = vault.availableBudgets(unknown);
        assertEq(weekly, 0); assertEq(total, 0);
        vm.expectRevert(AgentTreasury.AgentInactive.selector);
        vault.revokeAgent(unknown);
    }

    function testInvalidRecipientCountAndExpiry() public {
        address[] memory empty = new address[](0);
        vm.expectRevert(AgentTreasury.InvalidRecipientCount.selector);
        vault.configureAgent(AGENT, 2, MANDATE, UNIT, UNIT, UNIT, expires, empty);
        address[] memory many = new address[](65);
        vm.expectRevert(AgentTreasury.InvalidRecipientCount.selector);
        vault.configureAgent(AGENT, 2, MANDATE, UNIT, UNIT, UNIT, expires, many);
        address[] memory recipients = new address[](1); recipients[0] = MERCHANT;
        vm.expectRevert(AgentTreasury.InvalidAgentExpiry.selector);
        vault.configureAgent(AGENT, 2, MANDATE, UNIT, UNIT, UNIT, block.timestamp, recipients);
        recipients[0] = address(vault);
        vm.expectRevert(AgentTreasury.InvalidAddress.selector);
        vault.configureAgent(AGENT, 2, MANDATE, UNIT, UNIT, UNIT, expires, recipients);
    }

    function testConstructorRejectsNonContractTokenAndZeroExecutor() public {
        vm.expectRevert(AgentTreasury.InvalidAddress.selector);
        new AgentTreasury(STRANGER, address(this), EXECUTOR);
        vm.expectRevert(AgentTreasury.InvalidAddress.selector);
        new AgentTreasury(address(token), address(this), address(0));
        vm.expectRevert();
        new AgentTreasury(address(token), address(0), EXECUTOR);
        vm.expectRevert(AgentTreasury.InvalidAddress.selector);
        vault.setExecutor(address(0));
    }

    function testOwnershipTransferRequiresAcceptance() public {
        vault.transferOwnership(STRANGER);
        assertEq(uint160(vault.owner()), uint160(address(this)));
        vm.prank(EXECUTOR); vm.expectRevert(); vault.acceptOwnership();
        vm.prank(STRANGER); vault.acceptOwnership();
        assertEq(uint160(vault.owner()), uint160(STRANGER));
        vm.expectRevert(); vault.withdraw(address(this), UNIT);
        vm.prank(STRANGER); vault.withdraw(STRANGER, UNIT);
        assertEq(token.balanceOf(STRANGER), UNIT);
    }

    function testSpentBudgetsMatchReceiptAccounting() public {
        _pay(bytes32(uint256(1)), 1, MERCHANT, 8 * UNIT, block.timestamp + 1 hours);
        (uint256 week, uint256 weekly, uint256 total) = vault.spentBudgets(AGENT);
        assertEq(week, 10); assertEq(weekly, 8 * UNIT); assertEq(total, 8 * UNIT);
    }

    function testInvalidConfigurationRejected() public {
        vm.expectRevert(AgentTreasury.InvalidLimits.selector);
        _configure(2, 50 * UNIT, 40 * UNIT, 100 * UNIT, MERCHANT);
        vm.expectRevert(AgentTreasury.InvalidAddress.selector);
        _configure(2, 10 * UNIT, 40 * UNIT, 100 * UNIT, address(0));
        vm.expectRevert(AgentTreasury.InvalidReference.selector);
        address[] memory recipients = new address[](1); recipients[0] = MERCHANT;
        vault.configureAgent(bytes32(0), 2, MANDATE, UNIT, UNIT, UNIT, expires, recipients);
        vm.expectRevert(AgentTreasury.InvalidReference.selector);
        vault.configureAgent(AGENT, 2, bytes32(0), UNIT, UNIT, UNIT, expires, recipients);
    }

    function testFuzzPaymentNeverExceedsAvailableBudget(uint96 raw) public {
        uint256 amount = uint256(raw) % (10 * UNIT) + 1;
        _pay(keccak256(abi.encode(raw)), 1, MERCHANT, amount, block.timestamp + 1 hours);
        (uint256 weekly, uint256 total) = vault.availableBudgets(AGENT);
        assertEq(weekly + amount, 40 * UNIT);
        assertEq(total + amount, 100 * UNIT);
    }
}
