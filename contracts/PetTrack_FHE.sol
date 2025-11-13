pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PetTrack_FHE is ZamaEthereumConfig {
    struct PetData {
        string petName;
        euint32 encryptedLocation;
        uint256 publicData1;
        uint256 publicData2;
        string description;
        address owner;
        uint256 timestamp;
        uint32 decryptedLocation;
        bool isVerified;
    }

    mapping(string => PetData) public petData;
    string[] public petIds;

    event PetDataCreated(string indexed petId, address indexed owner);
    event DecryptionVerified(string indexed petId, uint32 decryptedLocation);

    constructor() ZamaEthereumConfig() {}

    function createPetData(
        string calldata petId,
        string calldata petName,
        externalEuint32 encryptedLocation,
        bytes calldata inputProof,
        uint256 publicData1,
        uint256 publicData2,
        string calldata description
    ) external {
        require(bytes(petData[petId].petName).length == 0, "Pet data already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedLocation, inputProof)), "Invalid encrypted input");

        petData[petId] = PetData({
            petName: petName,
            encryptedLocation: FHE.fromExternal(encryptedLocation, inputProof),
            publicData1: publicData1,
            publicData2: publicData2,
            description: description,
            owner: msg.sender,
            timestamp: block.timestamp,
            decryptedLocation: 0,
            isVerified: false
        });

        FHE.allowThis(petData[petId].encryptedLocation);
        FHE.makePubliclyDecryptable(petData[petId].encryptedLocation);
        petIds.push(petId);

        emit PetDataCreated(petId, msg.sender);
    }

    function verifyDecryption(
        string calldata petId, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(petData[petId].petName).length > 0, "Pet data does not exist");
        require(!petData[petId].isVerified, "Data already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(petData[petId].encryptedLocation);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

        petData[petId].decryptedLocation = decodedValue;
        petData[petId].isVerified = true;

        emit DecryptionVerified(petId, decodedValue);
    }

    function getEncryptedLocation(string calldata petId) external view returns (euint32) {
        require(bytes(petData[petId].petName).length > 0, "Pet data does not exist");
        return petData[petId].encryptedLocation;
    }

    function getPetData(string calldata petId) external view returns (
        string memory petName,
        uint256 publicData1,
        uint256 publicData2,
        string memory description,
        address owner,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedLocation
    ) {
        require(bytes(petData[petId].petName).length > 0, "Pet data does not exist");
        PetData storage data = petData[petId];

        return (
            data.petName,
            data.publicData1,
            data.publicData2,
            data.description,
            data.owner,
            data.timestamp,
            data.isVerified,
            data.decryptedLocation
        );
    }

    function getAllPetIds() external view returns (string[] memory) {
        return petIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


