pragma solidity ^0.4.13;

contract Remittance {
    event LogCreation(address indexed caller, uint256 indexed remittancePercentage, uint256 indexed maxBlockDuration);
    event LogDeposit(address caller, bytes32 indexed compoundHash, address indexed exchange, uint256 indexed blockDuration);
    event LogWithdraw(address caller, bytes32 indexed exchangeHash, bytes32 indexed beneficiaryHash, uint256 remittanceCommission, uint256 indexed netAmount);
    event LogClosed(address indexed caller);

    struct Payment {
        address payer;
        address exchange;
        uint256 amount;
        uint256 blockLimit;
        bool available;
    }

    address public owner;
    uint256 public maxBlockDuration;
    uint256 public remittancePercentage;
    mapping(bytes32 => Payment) public payments;
    mapping(address => uint256) public balanceOf;
    bool public closed;

    modifier onlyOwner {
        require(msg.sender == owner);
        _;
    }

    modifier notClosed {
        require(!closed);
        _;
    }

    function Remittance(uint256 _remittancePercentage, uint256 _maxBlockDuration) {
        require(0 < _remittancePercentage && _remittancePercentage < 100);
        require(_maxBlockDuration != 0);

        remittancePercentage = _remittancePercentage;
        maxBlockDuration = _maxBlockDuration;

        owner = msg.sender;

        LogCreation(msg.sender, _remittancePercentage, _maxBlockDuration);
    }

    function close() public notClosed onlyOwner {
        closed = true;
        
        LogClosed(msg.sender);

        selfdestruct(owner); // TODO: check spec: necessary?!?
    }

    function hash(bytes32 hash1, bytes32 hash2) public constant returns(bytes32 compoundHash) {
        return keccak256(hash1, hash2);
    }

    function deposit(bytes32 compoundHash, address exchange, uint256 blockDuration) public notClosed payable {
        require(exchange != address(0));
        require(0 < blockDuration && blockDuration <= maxBlockDuration);
        require(msg.value != 0);

        Payment storage newPayment = payments[compoundHash];

        newPayment.payer = msg.sender;
        newPayment.exchange = exchange;
        newPayment.amount = msg.value;
        newPayment.blockLimit = block.number + blockDuration;
        newPayment.available = true;

        LogDeposit(msg.sender, compoundHash, exchange, blockDuration);
    }

    function withdraw(bytes32 exchangeHash, bytes32 beneficiaryHash) public notClosed {
        bytes32 compoundHash = hash(exchangeHash, beneficiaryHash);
        Payment storage selectedPayment = payments[compoundHash];

        require(msg.sender == selectedPayment.exchange);
        require(block.number <= selectedPayment.blockLimit);
        require(selectedPayment.available);

        uint256 amount = selectedPayment.amount;
        uint256 remittanceCommission = amount / remittancePercentage;
        uint256 netAmount = amount - remittanceCommission;

        selectedPayment.available = false;

        owner.transfer(remittanceCommission);
        selectedPayment.exchange.transfer(netAmount);

        LogWithdraw(msg.sender, exchangeHash, beneficiaryHash, remittanceCommission, netAmount);
    }

    function () public {
        revert();
    }
}