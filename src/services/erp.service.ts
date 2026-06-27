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
 * Fetches item price details from ERPNext using get_item_details.
 * Called during payment initiation to get the authoritative price from the price list.
 *
 * @param itemCode - The ERPNext Item code
 * @returns Product details including price_list_rate as standard_rate
 */
export const getProductFromERP = async (itemCode: string): Promise<ErpProduct> => {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(
      `${env.ERP_BASE_URL}/api/method/erpnext.stock.get_item_details.get_item_details`,
      {
        method:  "POST",
        signal:  controller.signal,
        headers: {
          Authorization:  getAuthHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          args: {
            item_code:        itemCode,
            price_list:       env.ERP_SELLING_PRICE_LIST,
            qty:              1,
            uom:              "Pcs",
            company:          env.ERP_COMPANY,
            transaction_type: "selling",
            doctype:          "Sales Order",
          },
        }),
      }
    );

    if (!res.ok) throw new Error(`ERP product lookup failed: ${res.status}`);

    const data = await res.json() as {
      message: {
        item_code:       string;
        item_name:       string;
        price_list_rate: number;
        uom:             string;
        stock_uom:       string;
      };
    };

    const msg = data.message;
    return {
      item_code:     itemCode,
      item_name:     msg.item_name,
      standard_rate: msg.price_list_rate,
      stock_uom:     msg.uom ?? msg.stock_uom,
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

export async function createErpSalesOrder(
  transactionId: string,
  customerName: string,
  items: ErpItem[]
): Promise<ErpSalesOrderResponse> {
  const url = `${env.ERP_BASE_URL}/api/resource/Sales Order`;

  const requestBody: ErpSalesOrderRequest = {
    customer:         customerName,
    transaction_date: todayDate(),
    delivery_date:    deliveryDate(6),
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
