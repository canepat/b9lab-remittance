pragma solidity ^0.4.13;

import "./Pausable.sol";
import "./SafeMath.sol";

contract Remittance is Pausable {
    using SafeMath for uint256;

    event LogCreation(
        address indexed caller,
        uint256 indexed ownerCommission,
        uint256 indexed maxBlockDuration
    );
    event LogDeposit(
        address caller,
        bytes32 indexed compoundHash,
        //-address indexed exchange,
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
        //address exchange;
        uint256 amount;
        uint256 blockLimit;
    }

    uint256 public maxBlockDuration;
    uint256 public ownerCommission;
    mapping(bytes32 => Payment) public payments;
    uint256 public raisedFees;

    function Remittance(uint256 _ownerCommission, uint256 _maxBlockDuration) {
        require(_maxBlockDuration != 0);

        ownerCommission = _ownerCommission;
        maxBlockDuration = _maxBlockDuration;

        LogCreation(msg.sender, _ownerCommission, _maxBlockDuration);
    }

    function hash(bytes32 hash1, bytes32 hash2, address exchange)
    public constant returns(bytes32 compoundHash)
    {
        return keccak256(hash1, hash2, exchange);
    }

    function deposit(bytes32 compoundHash, /*address exchange, */uint256 blockDuration)
    public whenNotPaused payable
    {
        require(compoundHash != 0);
        //require(exchange != address(0));
        require(0 < blockDuration && blockDuration <= maxBlockDuration);
        require(msg.value != 0);

        Payment storage selectedPayment = payments[compoundHash];
        address payer = selectedPayment.payer;
        require(payer == 0 || payer == msg.sender);

        uint256 amount = selectedPayment.amount.add(msg.value);

        selectedPayment.payer = msg.sender;
        //selectedPayment.exchange = exchange;
        selectedPayment.amount = amount;
        selectedPayment.blockLimit = block.number + blockDuration;

        LogDeposit(msg.sender, compoundHash, /*exchange,*/ blockDuration, amount);
    }

    function withdraw(bytes32 exchangeHash, bytes32 beneficiaryHash) public whenNotPaused {
        bytes32 compoundHash = hash(exchangeHash, beneficiaryHash, msg.sender);
        Payment storage selectedPayment = payments[compoundHash];

        //require(msg.sender == selectedPayment.exchange);
        require(block.number <= selectedPayment.blockLimit);
        
        uint256 amount = selectedPayment.amount;
        require(amount > 0);
        
        selectedPayment.amount = 0;

        raisedFees = raisedFees.add(ownerCommission);

        uint256 netAmount = amount.sub(ownerCommission);

        LogWithdraw(msg.sender, exchangeHash, beneficiaryHash, ownerCommission, netAmount);

        //selectedPayment.exchange.transfer(netAmount);
        msg.sender.transfer(netAmount);
    }

    function withdrawFees() public onlyOwner whenNotPaused {
        uint256 feeAmount = raisedFees;
        require(feeAmount > 0);

        raisedFees = 0;

        LogWithdrawFees(msg.sender, feeAmount);

        owner.transfer(feeAmount);
    }

    function claim(bytes32 compoundHash) public whenNotPaused {
        require(compoundHash != 0);

        Payment storage selectedPayment = payments[compoundHash];

        require(msg.sender == selectedPayment.payer);
        require(block.number > selectedPayment.blockLimit);
        
        uint256 amount = selectedPayment.amount;
        require(amount > 0);

        selectedPayment.amount = 0;

        LogClaim(msg.sender, compoundHash, amount);

        msg.sender.transfer(amount);
    }
}