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
 * Fetches item price details from ERPNext by querying the "Item Price" resource
 * directly for the configured price list.
 *
 * NOTE: This bypasses erpnext.stock.get_item_details.get_item_details (which is
 * broken on this ERP instance — throws "missing 1 required positional argument: 'ctx'").
 * As a result, ERPNext Pricing Rules (qty breaks, discounts, etc.) are NOT applied —
 * this returns the flat price_list_rate from the price list.
 *
 * @param itemCode - The ERPNext Item code
 * @returns Product details including price_list_rate as standard_rate
 */
export const getProductFromERP = async (itemCode: string): Promise<ErpProduct> => {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 10_000);

  try {
    const filters = encodeURIComponent(
      JSON.stringify([
        ["item_code", "=", itemCode],
        ["price_list", "=", env.ERP_SELLING_PRICE_LIST],
        ["selling", "=", 1],
      ])
    );
    const fields = encodeURIComponent(
      JSON.stringify(["item_code", "item_name", "price_list_rate", "uom"])
    );

    const res = await fetch(
      `${env.ERP_BASE_URL}/api/resource/Item Price?filters=${filters}&fields=${fields}&limit_page_length=1`,
      {
        signal:  controller.signal,
        headers: { Authorization: getAuthHeader() },
      }
    );

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`ERP product lookup failed [${res.status}] for item_code "${itemCode}": ${errorBody}`);
    }

    const data = await res.json() as {
      data: Array<{
        item_code:       string;
        item_name:       string;
        price_list_rate: number;
        uom:             string;
      }>;
    };

    const item = data.data[0];
    if (!item) {
      throw new Error(
        `No price found for item_code "${itemCode}" in price list "${env.ERP_SELLING_PRICE_LIST}"`
      );
    }

    return {
      item_code:     itemCode,
      item_name:     item.item_name,
      standard_rate: item.price_list_rate,
      stock_uom:     item.uom ?? "Pcs",
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

    if (!searchRes.ok) {
      const errorBody = await searchRes.text();
      throw new Error(`ERP customer search failed [${searchRes.status}]: ${errorBody}`);
    }

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

    if (!createRes.ok) {
      const errorBody = await createRes.text();
      throw new Error(`ERP customer create failed [${createRes.status}]: ${errorBody}`);
    }

    const created = await createRes.json() as { data: { customer_name: string } };
    return created.data.customer_name as string;

  } finally {
    clearTimeout(timeout);
  }
};

// =============================================================================
// SALES ORDER CREATION
// =============================================================================

export async function createErpSalesOrder(
  transactionId: string,
  customerName: string,
  items: ErpItem[],
  customBuyerMessage: string,
  poNo: string
): Promise<ErpSalesOrderResponse> {
  const url = `${env.ERP_BASE_URL}/api/resource/Sales Order`;

  const baseDate = todayDate();
  const currentYear = new Date().getFullYear();

  const requestBody: ErpSalesOrderRequest = {
    naming_series:        `SAL-ORD-${currentYear}-`,
    customer:              customerName,
    company:               env.ERP_COMPANY,
    transaction_date:      baseDate,
    delivery_date:         deliveryDate(9),
    po_no:                 poNo,
    po_date:               baseDate,
    currency:               env.ERP_CURRENCY,
    selling_price_list:    env.ERP_SELLING_PRICE_LIST,
    price_list_currency:   env.ERP_CURRENCY,
    order_type:            "Sales",
    custom_buyer_message:  customBuyerMessage,
    items,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept:         "application/json",
      Authorization:  getAuthHeader(),
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `ERPNext API error [${response.status}] for transaction ${transactionId}: ${errorBody}`
    );
  }

  return response.json() as Promise<ErpSalesOrderResponse>;
}

/* OLD createErpSalesOrder — kept for reference
export async function createErpSalesOrderOld(
  transactionId: string,
  customerName: string,
  items: ErpItem[]
): Promise<ErpSalesOrderResponse> {
  const url = `${env.ERP_BASE_URL}/api/resource/Sales Order`;
  const today = todayDate();
  const delivery = deliveryDate(6);

  const requestBody = {
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

  return response.json() as Promise<ErpSalesOrderResponse>;
}
*/
