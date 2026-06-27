// =============================================================================
// DOKU TYPES
// =============================================================================

export interface DokuLineItem {
  name: string;
  price: number;
  quantity: number;
}

export interface DokuPaymentRequest {
  invoice_number: string; // our transaction UUID — used to correlate webhook
  amount: number;
  currency: string;
  callback_url: string;         // redirect after success
  callback_url_cancel: string;  // redirect after cancel/failure
  payment_due_date: number;     // minutes until expiry
  line_items: DokuLineItem[];
  customer: {
    id: string;
    name: string;
    email: string;
    phone: string;
    address: string;
  };
}

export interface DokuPaymentResponse {
  order: {
    invoice_number: string;
    amount: number;
  };
  payment: {
    expired_date: string;
    url: string;  // payment page URL — redirect user here
    token: string;
  };
  customer: {
    id: string;
    name: string;
    email: string;
    phone: string;
    address: string;
  };
}

export interface DokuWebhookPayload {
  order: {
    invoice_number: string; // matches our transaction UUID
    amount: number;
  };
  transaction: {
    status: "SUCCESS" | "FAILED" | "EXPIRED";
    date: string;
    original_request_id: string;
  };
  payment: {
    channel: string;
    payment_due_date: string;
  };
  customer?: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
  };
}

// =============================================================================
// ERPNEXT TYPES
// =============================================================================

export interface ErpItem {
  item_code: string;
  qty: number;
  rate: number;
  item_numbers?: string;
  item_address?: string;
  item_font?: string;
  font_style?: string;
}

export interface ErpSalesOrderRequest {
  customer: string;
  transaction_date: string;
  delivery_date: string;
  items: ErpItem[];
}

/* OLD ErpSalesOrderRequest — kept for reference
export interface ErpItemOld {
  item_code: string;
  qty: number;
  rate: number;
  delivery_date: string;
  warehouse: string;
  uom: string;
  conversion_factor: number;
  item_numbers?: string;
  item_address?: string;
  item_font?: string;
  font_style?: string;
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
  items: ErpItemOld[];
}

export interface ErpSalesOrderRequestOld {
  doc: ErpSalesOrderDoc;
}
*/

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
  content:   ItemContent[];
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

export interface ItemStyle {
  item_font: string;
  font_style: string;
}

export interface ItemContent {
  item_numbers: string;
  item_address: string;
  item_style: ItemStyle[];
}

export interface InitiatePaymentItem {
  item_code: string;
  item_name: string;
  quantity: number;
  content: ItemContent[];
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
