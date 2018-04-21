"use strict";

const MAX_UINT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const MAX_UINT_MINUS_1 = "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe";

const validCreationTestSet = [
    { ownerCommission:                0, maxBlockDuration:  1 },
    { ownerCommission:                1, maxBlockDuration:  1 },
    { ownerCommission:               10, maxBlockDuration:  1 },
    { ownerCommission:              100, maxBlockDuration:  1 },
    { ownerCommission:             1000, maxBlockDuration:  1 },
    { ownerCommission: MAX_UINT_MINUS_1, maxBlockDuration:  1 },
    { ownerCommission:         MAX_UINT, maxBlockDuration:  1 },
    { ownerCommission:                0, maxBlockDuration:  2 },
    { ownerCommission:                1, maxBlockDuration:  2 },
    { ownerCommission:               10, maxBlockDuration:  2 },
    { ownerCommission:              100, maxBlockDuration:  2 },
    { ownerCommission:             1000, maxBlockDuration:  2 },
    { ownerCommission: MAX_UINT_MINUS_1, maxBlockDuration:  2 },
    { ownerCommission:         MAX_UINT, maxBlockDuration:  2 },
    { ownerCommission:                0, maxBlockDuration: 10 },
    { ownerCommission:                1, maxBlockDuration: 10 },
    { ownerCommission:               10, maxBlockDuration: 10 },
    { ownerCommission:              100, maxBlockDuration: 10 },
    { ownerCommission:             1000, maxBlockDuration: 10 },
    { ownerCommission: MAX_UINT_MINUS_1, maxBlockDuration: 10 },
    { ownerCommission:         MAX_UINT, maxBlockDuration: 10 },
]

const invalidCreationTestSet = [
    { ownerCommission:                0, maxBlockDuration:  0 },
    { ownerCommission:                1, maxBlockDuration:  0 },
    { ownerCommission:               10, maxBlockDuration:  0 },
    { ownerCommission:              100, maxBlockDuration:  0 },
    { ownerCommission:             1000, maxBlockDuration:  0 },
    { ownerCommission: MAX_UINT_MINUS_1, maxBlockDuration:  0 },
    { ownerCommission:         MAX_UINT, maxBlockDuration:  0 },
]

module.exports = {
    validCreationTestSet: validCreationTestSet,
    invalidCreationTestSet: invalidCreationTestSet,
};