export const mapContractError = (err, isCasual, metadata = {}) => {
  const errStr = (err.reason || err.message || err.data?.message || "").toLowerCase();
  
  if (errStr.includes("maxbatchexceeded") || errStr.includes("batchquantityexceeded")) {
    return isCasual 
      ? "Whoops! To ensure safe transport, you can only bundle up to 6 fish per order. Let's split this into two boxes!" 
      : "Shipping box allocation limits reached. Maximum 6 specimens per consolidated order.";
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
      ? `This fish is currently in transit and protected. You'll be able to confirm delivery once the safety window closes.${suffix}`
      : `This specimen is in transit protection. Transfer controls unlock automatically once the 3-day safety window closes.${suffix}`;
  }
  
  if (errStr.includes("invalidcommitment")) {
    return "Verification failed: The PIN doesn't match. Please re-scan the QR code or double-check your PIN.";
  }
  
  if (errStr.includes("insufficientpayment") || errStr.includes("insufficient funds")) {
    return isCasual
      ? "It looks like there's not enough balance to complete this purchase."
      : "Purchase rejected: Insufficient balance.";
  }
  
  if (errStr.includes("listingnotactive")) {
    return isCasual
      ? "Oh no! It looks like this fish just found another home."
      : "This listing is no longer active — it may have been sold or removed.";
  }
  
  if (errStr.includes("unauthorized") || errStr.includes("callernotowner") || errStr.includes("callernotseller")) {
    return isCasual
      ? "Oops, you don't have permission to do that."
      : "Access denied: You are not authorized to perform this action.";
  }
  
  if (errStr.includes("timeout") || errStr.includes("network error") || errStr.includes("could not connect")) {
    return isCasual
      ? "We're having trouble connecting right now. Please try again in a moment."
      : "Connection timeout. Please check your internet and try again.";
  }
  
  return isCasual 
    ? "Oops, something went wrong. Please try again."
    : (err.reason || err.message || "Something went wrong. Please try again.");
};
