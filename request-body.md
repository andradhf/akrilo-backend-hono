
{
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `token ${API_KEY}:${API_SECRET}`
      },
      body: JSON.stringify({
        doc: {
          doctype: "Sales Order",
          customer: "rohim",
          company: "Akrilo Creations",
          transaction_date: "2026-05-09",
          delivery_date": "2026-05-15",
          order_type: "Sales",
          currency: "IDR",
          conversion_rate: 1,
          selling_price_list: "Standard Selling",
          price_list_currency: "IDR",
          plc_conversion_rate: 1,
          po_no: "PO-HONO-001",
          items: [
            {
              item_code: "TY-P1",
              qty: 1,
              rate: 100000,
              delivery_date: "2026-05-15",
              warehouse: "Finished Goods - AC",
              uom: "Pcs",
              conversion_factor: 1
            }
          ]
        }
      })
    })
