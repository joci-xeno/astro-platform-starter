// The daily profit target never grants authority. This is the single statement of which financial actions exist, which need a verified owner approval, and which are
// prohibited outright (speculation). Pure policy: it moves no money and holds no credentials. Crypto/Web3 WORK is ordinary revenue; crypto INVESTMENT is a different category and is refused.
export const FINANCIAL_ACTIONS = Object.freeze({
  SPEND: "OWNER_APPROVAL_REQUIRED", SUBSCRIBE: "OWNER_APPROVAL_REQUIRED", REFUND: "OWNER_APPROVAL_REQUIRED", TRANSFER_FUNDS: "OWNER_APPROVAL_REQUIRED", SIGN_CONTRACT: "OWNER_APPROVAL_REQUIRED",
  SEND_BINDING_PROPOSAL: "OWNER_APPROVAL_REQUIRED", CREATE_LIABILITY: "OWNER_APPROVAL_REQUIRED", CHANGE_PAYMENT_DESTINATION: "OWNER_APPROVAL_REQUIRED", DISABLE_SECURITY_CONTROL: "OWNER_APPROVAL_REQUIRED",
  CRYPTO_SERVICE_REVENUE: "ALLOWED_AS_REVENUE_CATEGORY_RECEIPT_STILL_NEEDS_SETTLEMENT_EVIDENCE",
  CRYPTO_INVESTMENT: "PROHIBITED", CRYPTO_TRADING: "PROHIBITED", TOKEN_PURCHASE: "PROHIBITED", AUTONOMOUS_INVESTMENT: "PROHIBITED", WALLET_TRANSFER: "PROHIBITED_WITHOUT_OWNER_SIGNED_APPROVAL_PER_TRANSFER",
});
export const CRYPTO_CURRENCIES = Object.freeze(new Set(["btc", "eth", "usdc", "usdt", "dai", "sol", "matic", "bnb", "xrp", "ltc", "doge", "ada", "avax", "trx"]));
export const isCryptoCurrency = c => CRYPTO_CURRENCIES.has(String(c ?? "").toLowerCase());
export const TARGET_OVERRIDES_AUTHORITY = false;

/** assessFinancialAction({action, approval, verifyApproval, subject, targetPressure}) -> {allowed, reason}. A shortfall against the daily target (`targetPressure`) changes nothing. */
export function assessFinancialAction({ action, approval = null, verifyApproval = null, subject = "", targetPressure = false } = {}) {
  const rule = FINANCIAL_ACTIONS[action]; if (!rule) return { allowed: false, reason: "UNKNOWN_FINANCIAL_ACTION_REFUSED", targetPressureIgnored: Boolean(targetPressure) };
  const base = { action, targetPressureIgnored: Boolean(targetPressure) };
  if (rule === "PROHIBITED") return { ...base, allowed: false, reason: "PROHIBITED_BY_POLICY_NO_APPROVAL_CAN_ENABLE" };
  if (rule.startsWith("ALLOWED")) return { ...base, allowed: true, reason: "CATEGORY_ALLOWED_AS_SERVICE_REVENUE", note: "An on-chain transfer is not settled profit until settlement is verified." };
  if (typeof verifyApproval !== "function" || !approval) return { ...base, allowed: false, reason: "OWNER_APPROVAL_REQUIRED" };
  let v; try { v = verifyApproval(approval, { action: "FINANCIAL_" + action, subject: String(subject) }); } catch { v = null; }
  return v?.allowed === true ? { ...base, allowed: true, reason: "OWNER_APPROVED" } : { ...base, allowed: false, reason: "OWNER_APPROVAL_INVALID" };
}
