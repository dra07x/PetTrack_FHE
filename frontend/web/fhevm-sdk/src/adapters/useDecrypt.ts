/**
 * Wagmi-like hook for decryption operations - FHE v0.9
 */

import { useState, useCallback } from 'react';
import { publicDecryptV09 } from '../core/index.js';

export function useDecrypt() {
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [error, setError] = useState<string>('');

  const verifyDecryption = useCallback(async (
    handles: string[], 
    contractAddress: string, 
    verifyFunction: (abiEncodedClearValues: string, decryptionProof: string) => Promise<any>
  ) => {
    setIsDecrypting(true);
    setError('');
    
    try {
      const decryptionResult = await publicDecryptV09(handles);
      
      const tx = await verifyFunction(
        decryptionResult.abiEncodedClearValues,
        decryptionResult.decryptionProof
      );
      
      const receipt = await tx.wait();
      
      return {
        decryptionResult,
        transactionReceipt: receipt
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decryption verification failed');
      throw err;
    } finally {
      setIsDecrypting(false);
    }
  }, []);

  return {
    verifyDecryption,
    isDecrypting,
    error,
  };
}


