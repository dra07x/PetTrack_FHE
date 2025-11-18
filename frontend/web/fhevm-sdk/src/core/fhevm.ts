/**
 * Universal FHEVM Core - Environment-Aware SDK
 * Supports both browser and Node.js environments
 * Preserves all existing browser functionality
 */

import { ethers } from "ethers";

let fheInstance: any = null;

/**
 * Initialize FHEVM instance for browser environment
 */
async function initializeBrowserFheInstance() {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('Ethereum provider not found. Please install MetaMask or connect a wallet.');
  }

  // Check for both uppercase and lowercase versions of RelayerSDK
  let sdk = (window as any).RelayerSDK || (window as any).relayerSDK;

  if (!sdk) {
    throw new Error('RelayerSDK not loaded. Please include the script tag in your HTML:\n<script src="https://cdn.zama.org/relayer-sdk-js/0.3.0-5/relayer-sdk-js.umd.cjs"></script>');
  }

  const { initSDK, createInstance, SepoliaConfig } = sdk;

  // Try to initialize SDK with CDN first (default behavior)
  // If it fails (e.g., CORS error), fallback to local WASM files
  try {
    await initSDK(); // Try CDN first
    console.log('✅ FHEVM SDK initialized with CDN');
  } catch (cdnError) {
    // If CDN fails (usually CORS), fallback to local WASM files
    console.warn('⚠️ CDN initialization failed, falling back to local WASM files:', cdnError);
    console.log('🔄 Trying local WASM files from public folder...');
    await initSDK({
      tfheParams: '/tfhe_bg.wasm',
      kmsParams: '/kms_lib_bg.wasm'
    });
    console.log('✅ FHEVM SDK initialized with local WASM files');
  }

  const config = { ...SepoliaConfig, network: window.ethereum };

  try {
    fheInstance = await createInstance(config);
    return fheInstance;
  } catch (err) {
    console.error('FHEVM browser instance creation failed:', err);
    throw err;
  }
}

/**
 * Initialize FHEVM instance for Node.js environment
 * REAL FUNCTIONALITY - uses actual RelayerSDK
 */
async function initializeNodeFheInstance(rpcUrl?: string) {
  try {
    console.log('🚀 Initializing REAL FHEVM Node.js instance...');
    
    // Use eval to prevent webpack from analyzing these imports
    const relayerSDKModule = await eval('import("@zama-fhe/relayer-sdk/node")');
    const { createInstance, SepoliaConfig, generateKeypair } = relayerSDKModule;
    
    // Create an EIP-1193 compatible provider for Node.js
    const ethersModule = await eval('import("ethers")');
    const provider = new ethersModule.ethers.JsonRpcProvider(rpcUrl || 'https://sepolia.infura.io/v3/96406da962744120afbe0cf64c8bd7b3');
    
    // Create EIP-1193 provider wrapper
    const eip1193Provider = {
      request: async ({ method, params }: { method: string; params: any[] }) => {
        switch (method) {
          case 'eth_chainId':
            return '0xaa36a7'; // Sepolia chain ID
          case 'eth_accounts':
            return ['---YOUR-ADDRESS-HERE---'];
          case 'eth_requestAccounts':
            return ['---YOUR-ADDRESS-HERE---'];
          case 'eth_call':
            // Use the real provider for blockchain calls
            return await provider.call(params[0]);
          case 'eth_sendTransaction':
            // Use the real provider for transactions
            return await provider.broadcastTransaction(params[0]);
          default:
            throw new Error(`Unsupported method: ${method}`);
        }
      },
      on: () => {},
      removeListener: () => {}
    };
    
    const config = { 
      ...SepoliaConfig, 
      network: eip1193Provider 
    };
    
    fheInstance = await createInstance(config);
    console.log('✅ REAL FHEVM Node.js instance created successfully!');
    return fheInstance;
  } catch (err) {
    console.error('FHEVM Node.js instance creation failed:', err);
    throw err;
  }
}

/**
 * Initialize FHEVM instance - Environment-aware
 * MAINTAINS BACKWARD COMPATIBILITY
 */
export async function initializeFheInstance(options?: { rpcUrl?: string }) {
  // Detect environment
  if (typeof window !== 'undefined' && window.ethereum) {
    // Browser environment - use existing working code
    return initializeBrowserFheInstance();
  } else {
    // Node.js environment - use new functionality
    return initializeNodeFheInstance(options?.rpcUrl);
  }
}

export function getFheInstance() {
  return fheInstance;
}

/**
 * Decrypt a single encrypted value using EIP-712 user decryption (matches showcase API)
 */
export async function decryptValue(encryptedBytes: string, contractAddress: string, signer: any): Promise<number> {
  const fhe = getFheInstance();
  if (!fhe) throw new Error('FHE instance not initialized. Call initializeFheInstance() first.');

  try {
    console.log('🔐 Using EIP-712 user decryption for handle:', encryptedBytes);
    
    // Use EIP-712 user decryption instead of public decryption
    const keypair = fhe.generateKeypair();
    const handleContractPairs = [
      {
        handle: encryptedBytes,
        contractAddress: contractAddress,
      },
    ];
    
    const startTimeStamp = Math.floor(Date.now() / 1000).toString();
    const durationDays = "10";
    const contractAddresses = [contractAddress];

    const eip712 = fhe.createEIP712(
      keypair.publicKey,
      contractAddresses,
      startTimeStamp,
      durationDays
    );

    const signature = await signer.signTypedData(
      eip712.domain,
      {
        UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
      },
      eip712.message
    );

    const result = await fhe.userDecrypt(
      handleContractPairs,
      keypair.privateKey,
      keypair.publicKey,
      signature.replace("0x", ""),
      contractAddresses,
      await signer.getAddress(),
      startTimeStamp,
      durationDays
    );

    return Number(result[encryptedBytes]);
  } catch (error: any) {
    // Check for relayer/network error
    if (error?.message?.includes('Failed to fetch') || error?.message?.includes('NetworkError')) {
      throw new Error('Decryption service is temporarily unavailable. Please try again later.');
    }
    throw error;
  }
}

/**
 * Batch decrypt multiple encrypted values using EIP-712 user decryption
 */
export async function batchDecryptValues(
  handles: string[], 
  contractAddress: string, 
  signer: any
): Promise<Record<string, number>> {
  const fhe = getFheInstance();
  if (!fhe) throw new Error('FHE instance not initialized. Call initializeFheInstance() first.');

  try {
    console.log('🔐 Using EIP-712 batch user decryption for handles:', handles);
    
    const keypair = fhe.generateKeypair();
    const handleContractPairs = handles.map(handle => ({
      handle,
      contractAddress: contractAddress,
    }));
    
    const startTimeStamp = Math.floor(Date.now() / 1000).toString();
    const durationDays = "10";
    const contractAddresses = [contractAddress];

    const eip712 = fhe.createEIP712(
      keypair.publicKey,
      contractAddresses,
      startTimeStamp,
      durationDays
    );

    const signature = await signer.signTypedData(
      eip712.domain,
      {
        UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
      },
      eip712.message
    );

    const result = await fhe.userDecrypt(
      handleContractPairs,
      keypair.privateKey,
      keypair.publicKey,
      signature.replace("0x", ""),
      contractAddresses,
      await signer.getAddress(),
      startTimeStamp,
      durationDays
    );

    // Convert result to numbers
    const decryptedValues: Record<string, number> = {};
    for (const handle of handles) {
      decryptedValues[handle] = Number(result[handle]);
    }

    return decryptedValues;
  } catch (error: any) {
    if (error?.message?.includes('Failed to fetch') || error?.message?.includes('NetworkError')) {
      throw new Error('Decryption service is temporarily unavailable. Please try again later.');
    }
    throw error;
  }
}

/**
 * Encrypt values using FHEVM
 * 
 * 📝 BIT SIZE SUPPORT:
 * FHEVM supports different bit sizes for encrypted values. If your contract uses a different bit size
 * than the default 32-bit, you can use the appropriate method:
 * - add8(value)   - for 8-bit values (0-255)
 * - add16(value) - for 16-bit values (0-65535) 
 * - add32(value) - for 32-bit values (0-4294967295) - DEFAULT
 * - add64(value) - for 64-bit values (0-18446744073709551615)
 * - add128(value) - for 128-bit values
 * - add256(value) - for 256-bit values
 * 
 * Example: If your contract expects 8-bit values, replace add32() with add8()
 */
export async function encryptValue(
  contractAddress: string,
  address: string,
  plainDigits: number[]
) {
  const relayer = getFheInstance();
  if (!relayer) throw new Error("FHEVM not initialized");

  const inputHandle = relayer.createEncryptedInput(contractAddress, address);
  for (const d of plainDigits) {
    inputHandle.add8(d);
  }
  
  const ciphertextBlob = await inputHandle.encrypt();
  return ciphertextBlob;
}

/**
 * Create encrypted input for contract interaction (matches showcase API)
 */
export async function createEncryptedInput(contractAddress: string, userAddress: string, value: number) {
  const fhe = getFheInstance();
  if (!fhe) throw new Error('FHE instance not initialized. Call initializeFheInstance() first.');

  console.log(`🔐 Creating encrypted input for contract ${contractAddress}, user ${userAddress}, value ${value}`);
  
  const inputHandle = fhe.createEncryptedInput(contractAddress, userAddress);
  inputHandle.add32(value);
  const result = await inputHandle.encrypt();
  
  console.log('✅ Encrypted input created successfully');
  console.log('🔍 Encrypted result structure:', result);
  
  // The FHEVM SDK returns an object with handles and inputProof
  // We need to extract the correct values for the contract
  if (result && typeof result === 'object') {
    // If result has handles array, use the first handle
    if (result.handles && Array.isArray(result.handles) && result.handles.length > 0) {
      return {
        encryptedData: result.handles[0],
        proof: result.inputProof
      };
    }
    // If result has encryptedData and proof properties
    else if (result.encryptedData && result.proof) {
      return {
        encryptedData: result.encryptedData,
        proof: result.proof
      };
    }
    // Fallback: use the result as-is
    else {
      return {
        encryptedData: result,
        proof: result
      };
    }
  }
  
  // If result is not an object, use it directly
  return {
    encryptedData: result,
    proof: result
  };
}

export async function publicDecryptV09(handles: string[]): Promise<{
  clearValues: { [handle: string]: bigint };
  abiEncodedClearValues: string;
  decryptionProof: string;
}> {
  const fhe = getFheInstance();
  if (!fhe) throw new Error('FHE instance not initialized. Call initializeFheInstance() first.');

  try {
    console.log('🔐 Starting v0.9 public decryption for handles:', handles);
    
    if (typeof fhe.publicDecrypt === 'function') {
      const result = await fhe.publicDecrypt(handles);
      
      if (result && result.clearValues && result.abiEncodedClearValues && result.decryptionProof) {
        return result;
      } else {
        throw new Error('Invalid publicDecrypt result structure');
      }
    } else {
      console.warn('⚠️ Using fallback decryption for v0.9 compatibility');
      
      const clearValues: { [handle: string]: bigint } = {};
      let abiEncodedClearValues = '0x';
      const decryptionProof = '0x';
      
      for (const handle of handles) {
        if (typeof handle === "string" && handle.startsWith("0x") && handle.length === 66) {
          const values = await fhe.publicDecrypt([handle]);
          const clearValue = BigInt(values[handle]);
          clearValues[handle] = clearValue;
        } else {
          throw new Error('Invalid ciphertext handle for decryption');
        }
      }

      if (handles.length === 1) {

        abiEncodedClearValues = ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint32'], 
          [Number(clearValues[handles[0]])]
        );
      } else {

        const values = handles.map(handle => Number(clearValues[handle]));
        abiEncodedClearValues = ethers.AbiCoder.defaultAbiCoder().encode(
          Array(values.length).fill('uint32'), 
          values
        );
      }
      
      return {
        clearValues,
        abiEncodedClearValues,
        decryptionProof
      };
    }
  } catch (error: any) {
    if (error?.message?.includes('Failed to fetch') || error?.message?.includes('NetworkError')) {
      throw new Error('Decryption service is temporarily unavailable. Please try again later.');
    }
    throw error;
  }
}


