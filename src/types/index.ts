// =============================================================================
// XENDIT TYPES
// =============================================================================

export interface XenditInvoiceRequest {
  external_id: string;
  amount: number;
  description: string;
  invoice_duration?: number; // seconds, default 86400 (24h)
  items?: XenditInvoiceItem[];
  currency?: string;
  success_redirect_url?: string;
  failure_redirect_url?: string;
}

export interface XenditInvoiceItem {
  name: string;
  quantity: number;
  price: number;
  category?: string;
}

export interface XenditInvoiceResponse {
  id: string;
  external_id: string;
  status: string;
  amount: number;
  invoice_url: string;
  expiry_date: string;
  description: string;
}

/**
 * Xendit Webhook Payload (Invoice Paid callback)
 * https://developers.xendit.co/api-reference/#invoice-callback
 */
export interface XenditWebhookPayload {
  id: string;
  external_id: string;
  status: "PAID" | "EXPIRED";
  amount: number;
  payer_email?: string;
  paid_amount?: number;
  paid_at?: string;
  payment_method?: string;
  payment_channel?: string;
  payment_destination?: string;
  currency?: string;
  description?: string;
}

// =============================================================================
// ERPNEXT TYPES
// =============================================================================

export interface ErpItem {
  item_code: string;
  qty: number;
  rate: number;
  delivery_date: string;
  warehouse: string;
  uom: string;
  conversion_factor: number;
}

export interface ErpSalesOrderDoc {
  doctype: "Sales Order";
  customer: string;
  company: string;
  transaction_date: string;
  delivery_date: string;
  order_type: "Sales";
  currency: string;
  conversion_rate: number;
  selling_price_list: string;
  price_list_currency: string;
  plc_conversion_rate: number;
  po_no: string;
  items: ErpItem[];
}

export interface ErpSalesOrderRequest {
  doc: ErpSalesOrderDoc;
}

export interface ErpSalesOrderResponse {
  data: {
    name: string;
    docstatus: number;
    customer: string;
    transaction_date: string;
    grand_total: number;
  };
}

/**
 * ERP Product lookup result — returned by getProductFromERP()
 */
export interface ErpProduct {
  item_code:     string;
  item_name:     string;
  standard_rate: number;
  stock_uom:     string;
}

/**
 * Enriched item — after ERP price fetch, used internally
 */
export interface EnrichedItem {
  item_code: string;
  item_name: string;
  quantity:  number;
  rate:      number;   // always from ERP
  uom:       string;
  warehouse: string;
}

// =============================================================================
// USER TYPES
// =============================================================================

export interface UserDetail {
  id:         number;
  name:       string;
  phone:      string;
  address:    string;
  created_at: Date;
}

// =============================================================================
// BULLMQ JOB DATA
// =============================================================================

export interface ErpJobData {
  transactionId: string;
  userId: number;
}

// =============================================================================
// REQUEST / RESPONSE TYPES
// =============================================================================

export interface UserInitiateRequest {
  user: {
    name: string;
    phone: string;
    address: string;
  };
}

export interface UserInitiateResponse {
  success: true;
  user_id: number;
  phone: string;
  erp_customer: string;
}

export interface InitiatePaymentItem {
  item_code: string;
  item_name: string;
  quantity: number;
}

export interface InitiatePaymentRequest {
  phone: string;
  items: InitiatePaymentItem[];
}

export interface InitiatePaymentResponse {
  success: true;
  invoice_url: string;
  transaction_id: string;
}

export interface ErrorResponse {
  success: false;
  error: string;
  details?: unknown;
}
