import { env } from "../lib/env";
import type {
  ErpSalesOrderRequest,
  ErpSalesOrderResponse,
  ErpItem,
  ErpProduct,
} from "../types/index";

/**
 * ERPNext (Frappe) REST API client for creating Sales Orders,
 * fetching product details, and registering customers.
 *
 * Auth: token {API_KEY}:{API_SECRET} — as documented in Frappe REST API.
 */

function getAuthHeader(): string {
  return `token ${env.ERP_API_KEY}:${env.ERP_API_SECRET}`;
}

/**
 * Helper: Returns today's date in YYYY-MM-DD format.
 */
function todayDate(): string {
  return new Date().toISOString().split("T")[0]!;
}

/**
 * Helper: Returns a delivery date N days from today in YYYY-MM-DD format.
 */
function deliveryDate(daysFromNow: number = 6): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().split("T")[0]!;
}

// =============================================================================
// PRODUCT LOOKUP
// =============================================================================

/**
 * Fetches item details (including price) from ERPNext.
 * Called during payment initiation to get the authoritative price.
 *
 * @param itemCode - The ERPNext Item code
 * @returns Product details including standard_rate
 */
export const getProductFromERP = async (itemCode: string): Promise<ErpProduct> => {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(
      `${env.ERP_BASE_URL}/api/resource/Item/${encodeURIComponent(itemCode)}`,
      {
        signal:  controller.signal,
        headers: {
          Authorization:  getAuthHeader(),
          'Content-Type': 'application/json',
        },
      }
    );

    if (!res.ok) throw new Error(`ERP product lookup failed: ${res.status}`);

    const data = await res.json() as { data: { name: string; item_name: string; standard_rate: number; stock_uom: string } };
    return {
      item_code:     data.data.name           as string,
      item_name:     data.data.item_name      as string,
      standard_rate: data.data.standard_rate  as number,
      stock_uom:     data.data.stock_uom      as string,
    };
  } finally {
    clearTimeout(timeout);
  }
};

// =============================================================================
// CUSTOMER REGISTRATION
// =============================================================================

/**
 * Checks if a customer exists in ERPNext by phone number.
 * Creates a new Customer if not found.
 * Called inside the BullMQ worker before creating the Sales Order.
 *
 * @param customer - Customer details (name, phone, address)
 * @returns The ERPNext customer_name (their internal identifier)
 */
export const registerOrGetCustomer = async (customer: {
  name:    string;
  phone:   string;
  address: string;
}): Promise<string> => {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 10_000);

  try {
    const encoded = encodeURIComponent(
      JSON.stringify([['mobile_no', '=', customer.phone]])
    );
    const searchRes = await fetch(
      `${env.ERP_BASE_URL}/api/resource/Customer?filters=${encoded}&fields=["name","customer_name"]`,
      {
        signal:  controller.signal,
        headers: { Authorization: getAuthHeader() },
      }
    );

    const searchData = await searchRes.json() as { data: Array<{ name: string; customer_name: string }> };

    if (searchData.data && searchData.data.length > 0) {
      return searchData.data[0]!.customer_name as string;
    }

    // Not found — create new customer
    const createRes = await fetch(`${env.ERP_BASE_URL}/api/resource/Customer`, {
      method: 'POST',
      headers: {
        Authorization:  getAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customer_name:  `web - ${customer.name}`,
        customer_type:  'Individual',
        customer_group: 'Individual',
        territory:      'All Territories',
        mobile_no:      customer.phone,
      }),
    });

    const created = await createRes.json() as { data: { customer_name: string } };
    return created.data.customer_name as string;

  } finally {
    clearTimeout(timeout);
  }
};

// =============================================================================
// SALES ORDER CREATION
// =============================================================================

/**
 * Creates a Sales Order in ERPNext for a completed payment.
 *
 * This function is called by the BullMQ worker after a successful payment.
 * Retry logic is handled at the queue level (3 attempts, exponential backoff).
 *
 * @param transactionId - The internal transaction UUID (used as PO number)
 * @param customerName  - The verified ERPNext customer name
 * @param items         - The purchased items to include in the Sales Order
 * @returns ERPNext Sales Order response with the order name (e.g., "SAL-ORD-00001")
 */
export async function createErpSalesOrder(
  transactionId: string,
  customerName: string,
  items: ErpItem[]
): Promise<ErpSalesOrderResponse> {
  const url = `${env.ERP_BASE_URL}/api/resource/Sales Order`;

  const today = todayDate();
  const delivery = deliveryDate(6);

  const requestBody: ErpSalesOrderRequest = {
    doc: {
      doctype: "Sales Order",
      customer: customerName,
      company: env.ERP_COMPANY,
      transaction_date: today,
      delivery_date: delivery,
      order_type: "Sales",
      currency: env.ERP_CURRENCY,
      conversion_rate: 1,
      selling_price_list: env.ERP_SELLING_PRICE_LIST,
      price_list_currency: env.ERP_CURRENCY,
      plc_conversion_rate: 1,
      // Use transaction UUID as PO number for traceability
      po_no: `PO-${transactionId.slice(0, 8).toUpperCase()}`,
      items: items.map((item) => ({
        ...item,
        delivery_date: delivery,
        warehouse: item.warehouse ?? env.ERP_WAREHOUSE,
        uom: item.uom ?? "Pcs",
        conversion_factor: 1,
      })),
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: getAuthHeader(),
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `ERPNext API error [${response.status}] for transaction ${transactionId}: ${errorBody}`
    );
  }

  const data = await response.json() as ErpSalesOrderResponse;
  return data;
}
