export const mapContractError = (err, isCasual, metadata = {}) => {
  const errStr = (err.reason || err.message || err.data?.message || "").toLowerCase();
  
  if (errStr.includes("maxbatchexceeded") || errStr.includes("batchquantityexceeded")) {
    return isCasual 
      ? "Whoops! To ensure safe transport, you can only bundle up to 6 fish per order. Let's split this into two boxes!" 
      : "Security Protocol: Shipping box allocation limits reached. Consolidate current queue or initialize a secondary transport manifest (Max 6 specimens per batch).";
  }
  
  if (errStr.includes("safetywindownotelapsed") || errStr.includes("escrowlocked") || errStr.includes("escrownotdispatched")) {
    let suffix = "";
    if (metadata.dispatchTimestamp && metadata.safetyWindowSeconds) {
      const remainingSeconds = (metadata.dispatchTimestamp + metadata.safetyWindowSeconds) - Math.floor(Date.now() / 1000);
      if (remainingSeconds > 0) {
        const hours = Math.ceil(remainingSeconds / 3600);
        suffix = ` (Time remaining: ~${hours} hours)`;
      }
    }
    
    return isCasual
      ? `Security Notice: This specimen is safely secured in transit escrow protection. Custody transfer controls unlock automatically once the standard transit safety window closes.${suffix}`
      : `Security Notice: This specimen is safely secured in transit escrow protection. Custody transfer controls unlock automatically once the standard transit safety window closes.${suffix}`;
  }
  
  if (errStr.includes("invalidcommitment")) {
    return "Verification Fault: Handshake security tokens or PIN parameters do not match. Please re-scan the secure handshake voucher.";
  }
  
  if (errStr.includes("insufficientpayment") || errStr.includes("insufficient funds")) {
    return isCasual
      ? "It looks like you need a bit more balance to complete this transaction."
      : "Transaction rejected: Insufficient ledger balance.";
  }
  
  if (errStr.includes("listingnotactive")) {
    return isCasual
      ? "Oh no! It looks like this fish just found another home."
      : "Action failed: Registry entry is no longer active.";
  }
  
  if (errStr.includes("unauthorized") || errStr.includes("callernotowner") || errStr.includes("callernotseller")) {
    return isCasual
      ? "Oops, you don't have permission to do that."
      : "Access Denied: Unrecognized cryptographic signer.";
  }
  
  if (errStr.includes("timeout") || errStr.includes("network error") || errStr.includes("could not connect")) {
    return isCasual
      ? "We're having trouble connecting to the network right now. Please try again."
      : "Network latency timeout. Node connection unstable.";
  }
  
  return isCasual 
    ? "Oops, something went wrong with the transaction. Please try again."
    : (err.reason || err.message || "Encrypted Ledger Transaction Failed.");
};
