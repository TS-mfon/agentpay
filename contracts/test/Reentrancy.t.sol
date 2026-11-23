// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AgentTreasury} from "../src/AgentTreasury.sol";
import {TestSupport, MockToken} from "./TestSupport.sol";

contract OwnerHook {
    AgentTreasury public vault;
    bool public nestedSucceeded;
    function setVault(AgentTreasury value) external { vault = value; }
    function withdraw(uint256 amount) external { vault.withdraw(address(this), amount); }
    function onTokenTransfer() external {
        (nestedSucceeded,) = address(vault).call(abi.encodeCall(vault.withdraw, (address(this), 1)));
    }
}

contract ExecutorHook {
    AgentTreasury public vault;
    bool public nestedSucceeded;
    bytes32 public constant AGENT = keccak256("hook-agent");
    function setVault(AgentTreasury value) external { vault = value; }
    function pay(bytes32 requestId) external {
        vault.executePayment(requestId, AGENT, 1, address(0xA1), 1,
            block.timestamp + 1 hours, keccak256("request"), keccak256("decision"));
    }
    function onTokenTransfer() external {
        (nestedSucceeded,) = address(vault).call(abi.encodeCall(vault.executePayment,
            (keccak256("nested"), AGENT, 1, address(0xA1), 1,
             block.timestamp + 1 hours, keccak256("request"), keccak256("decision"))));
    }
}

contract ReentrancyTest is TestSupport {
    function testMaliciousTokenCannotReenterPayment() public {
        vm.warp(10 * 7 days);
        MockToken token = new MockToken();
        ExecutorHook hook = new ExecutorHook();
        AgentTreasury vault = new AgentTreasury(address(token), address(this), address(hook));
        hook.setVault(vault);
        address[] memory recipients = new address[](1); recipients[0] = address(0xA1);
        vault.configureAgent(hook.AGENT(), 1, keccak256("mandate"), 10, 40, 100,
            block.timestamp + 1 days, recipients);
        token.mint(address(vault), 10);
        token.setTransferHook(address(hook));
        hook.pay(keccak256("outer"));
        assertFalse(hook.nestedSucceeded());
        assertTrue(vault.executed(keccak256("outer")));
        assertFalse(vault.executed(keccak256("nested")));
        assertEq(token.balanceOf(address(0xA1)), 1);
    }

    function testMaliciousTokenCannotReenterWithdrawal() public {
        MockToken token = new MockToken();
        OwnerHook hook = new OwnerHook();
        AgentTreasury vault = new AgentTreasury(address(token), address(hook), address(0xE1));
        hook.setVault(vault);
        token.mint(address(vault), 10);
        token.setTransferHook(address(hook));
        hook.withdraw(5);
        assertFalse(hook.nestedSucceeded());
        assertEq(token.balanceOf(address(vault)), 5);
        assertEq(token.balanceOf(address(hook)), 5);
    }
}
