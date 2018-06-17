pragma solidity ^0.4.24;

import "./Pausable.sol";
import "./SafeMath.sol";

contract Remittance is Pausable {
    using SafeMath for uint256;

    event LogRemittanceCreation(
        address indexed caller,
        uint256 indexed ownerCommission,
        uint256 indexed maxBlockDuration
    );
    event LogOwnerCommissionChanged(
        address indexed caller,
        uint256 indexed oldCommission,
        uint256 indexed newCommission
    );
    event LogDeposit(
        address caller,
        bytes32 indexed compoundHash,
        uint256 indexed blockDuration,
        uint256 amount
    );
    event LogWithdraw(
        address caller,
        bytes32 indexed exchangeHash,
        bytes32 indexed beneficiaryHash,
        uint256 ownerCommission,
        uint256 indexed netAmount
    );
    event LogWithdrawFees(
        address indexed caller,
        uint256 indexed fees
    );
    event LogClaim(
        address indexed caller,
        bytes32 indexed compoundHash,
        uint256 indexed amount
    );

    struct Payment {
        address payer;
        uint256 amount;
        uint256 blockLimit;
    }

    uint256 public maxBlockDuration;
    uint256 public ownerCommission;
    mapping(bytes32 => Payment) public payments;
    uint256 public raisedFees;

    constructor(uint256 _ownerCommission, uint256 _maxBlockDuration) public {
        require(_maxBlockDuration != 0, "Remittance: _maxBlockDuration is zero");

        ownerCommission = _ownerCommission;
        maxBlockDuration = _maxBlockDuration;

        emit LogRemittanceCreation(msg.sender, _ownerCommission, _maxBlockDuration);
    }

    function hash(bytes32 hash1, bytes32 hash2, address exchange)
    public constant returns(bytes32 compoundHash)
    {
        return keccak256(abi.encodePacked(this, hash1, hash2, exchange));
    }

    function setOwnerCommission(uint256 newOwnerCommission) public whenNotPaused onlyOwner {
        uint256 oldOwnerCommission = ownerCommission;
        require(newOwnerCommission != oldOwnerCommission, "setOwnerCommission: newOwnerCommission equal to old one");

        ownerCommission = newOwnerCommission;

        emit LogOwnerCommissionChanged(msg.sender, oldOwnerCommission, newOwnerCommission);
    }

    function deposit(bytes32 compoundHash, uint256 blockDuration)
    public whenNotPaused payable
    {
        require(compoundHash != 0, "deposit: compoundHash is zero");
        require(0 < blockDuration && blockDuration <= maxBlockDuration, "deposit: blockDuration out of range");
        require(msg.value != 0, "deposit: msg.value is zero");

        Payment storage selectedPayment = payments[compoundHash];
        address payer = selectedPayment.payer;
        require(payer == 0 || payer == msg.sender);

        uint256 amount = selectedPayment.amount.add(msg.value);
        require(amount > ownerCommission);

        selectedPayment.payer = msg.sender;
        selectedPayment.amount = amount;
        selectedPayment.blockLimit = block.number + blockDuration;

        emit LogDeposit(msg.sender, compoundHash, blockDuration, amount);
    }

    function withdraw(bytes32 exchangeHash, bytes32 beneficiaryHash) public whenNotPaused {
        bytes32 compoundHash = hash(exchangeHash, beneficiaryHash, msg.sender);
        Payment storage selectedPayment = payments[compoundHash];

        require(block.number <= selectedPayment.blockLimit, "withdraw: block.number greater than limit");
        
        uint256 amount = selectedPayment.amount;
        require(amount > 0, "withdraw: payment amount is zero");
        
        selectedPayment.amount = 0;

        raisedFees = raisedFees.add(ownerCommission);

        uint256 netAmount = amount.sub(ownerCommission);

        emit LogWithdraw(msg.sender, exchangeHash, beneficiaryHash, ownerCommission, netAmount);

        msg.sender.transfer(netAmount);
    }

    function withdrawFees() public onlyOwner whenNotPaused {
        uint256 feeAmount = raisedFees;
        require(feeAmount > 0, "withdrawFees: fee amount is zero");

        raisedFees = 0;

        emit LogWithdrawFees(msg.sender, feeAmount);

        owner.transfer(feeAmount);
    }

    function claim(bytes32 compoundHash) public whenNotPaused {
        require(compoundHash != 0, "claim: compoundHash is zero");

        Payment storage selectedPayment = payments[compoundHash];

        require(msg.sender == selectedPayment.payer, "claim: msg.sender is not payment sender");
        require(block.number > selectedPayment.blockLimit, "claim: block.number greater than limit");
        
        uint256 amount = selectedPayment.amount;
        require(amount > 0, "claim: payment amount is zero");

        selectedPayment.amount = 0;

        emit LogClaim(msg.sender, compoundHash, amount);

        msg.sender.transfer(amount);
    }
}