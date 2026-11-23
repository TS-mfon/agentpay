// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface Vm {
    struct Log { bytes32[] topics; bytes data; address emitter; }
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
    function expectRevert() external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata data) external;
}

abstract contract TestSupport {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "uint assertion failed");
    }
    function assertTrue(bool value) internal pure { require(value, "bool assertion failed"); }
    function assertFalse(bool value) internal pure { require(!value, "bool assertion failed"); }
}

contract MockToken {
    mapping(address => uint256) public balanceOf;
    bool public failTransfers;
    address public transferHook;
    uint8 public constant decimals = 6;
    function mint(address recipient, uint256 amount) external { balanceOf[recipient] += amount; }
    function setFailTransfers(bool value) external { failTransfers = value; }
    function setTransferHook(address value) external { transferHook = value; }
    function transfer(address recipient, uint256 amount) external returns (bool) {
        if (failTransfers) return false;
        require(balanceOf[msg.sender] >= amount, "insufficient token balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        if (transferHook != address(0)) {
            (bool ok,) = transferHook.call(abi.encodeWithSignature("onTokenTransfer()"));
            require(ok, "hook failed");
        }
        return true;
    }
}
