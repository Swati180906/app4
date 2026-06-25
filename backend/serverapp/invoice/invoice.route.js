const express = require("express");
const invoiceRoute = express.Router();
const Invoice = require("./invoice.model");
const Razorpay = require("razorpay");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

// =============================
// Razorpay Configuration
// =============================

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// =============================
// Email Configuration
// =============================

const emailUser = process.env.GMAIL_USER || process.env.EMAIL;
const emailPass = process.env.GMAIL_APP_PASS || process.env.EMAIL_PASSWORD;

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: emailUser, pass: emailPass },
});

async function sendInvoiceEmail(customerEmail, invoiceData, isPaid) {
    try {
        const items = invoiceData.items || (invoiceData.pid ? [invoiceData] : []);
        const itemsHtml = items.map(item =>
            `<tr><td>${item.pname}</td><td>${item.quantity}</td><td>₹${Number(item.opprice)}</td><td>₹${Number(item.opprice) * item.quantity}</td></tr>`
        ).join("");

        await transporter.sendMail({
            from: emailUser,
            to: customerEmail,
            subject: `Invoice #${invoiceData.invoiceId} - ${isPaid ? "Payment Confirmed" : "Invoice Generated"}`,
            html: `
                <h2>${isPaid ? "Payment Successful" : "Invoice Generated"}</h2>
                <p>Dear ${invoiceData.CustomerName},</p>
                <p>Your invoice has been ${isPaid ? "paid" : "generated"} successfully.</p>
                <hr/>
                <h3>Invoice #${invoiceData.invoiceId}</h3>
                <p><strong>Date:</strong> ${new Date(invoiceData.invoiceDate || Date.now()).toLocaleDateString()}</p>
                <p><strong>Status:</strong> ${isPaid ? "Paid" : "Pending"}</p>
                <hr/>
                <h3>Products</h3>
                <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%">
                    <thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
                    <tbody>${itemsHtml}</tbody>
                </table>
                <hr/>
                <h3>Total Amount: ₹${invoiceData.totalAmount}</h3>
                <p>Thank you for shopping with us!</p>
            `,
        });
        console.log("Invoice email sent to", customerEmail);
    } catch (err) {
        console.error("Failed to send invoice email:", err.message);
    }
}

// =============================
// Create Invoice
// =============================

invoiceRoute.post("/create", async (req, res) => {
    try {
        const { CId, CustomerName, CContact, CEmail, CAddress, items, pid, pname, opprice, quantity } = req.body;

        if (!CId) {
            return res.status(400).json({ error: "Customer ID is required" });
        }

        const customerInfo = {
            CId: Number(CId),
            CustomerName: CustomerName || "",
            CContact: CContact || "",
            CEmail: CEmail || "",
            CAddress: CAddress || "",
        };

        const productItems = items || (pid ? [{ pid, pname, opprice, quantity }] : []);

        if (productItems.length === 0) {
            return res.status(400).json({ error: "At least one product is required" });
        }

        const lastInvoice = await Invoice.findOne().sort({ invoiceId: -1 });
        let nextId = lastInvoice ? lastInvoice.invoiceId + 1 : 1;

        const createdInvoices = [];
        let totalAmount = 0;

        for (const item of productItems) {
            if (!item.pid || !item.pname || !item.opprice) {
                return res.status(400).json({ error: "Each product must have pid, pname, and opprice" });
            }

            const qty = item.quantity || 1;
            const itemTotal = Number(item.opprice) * qty;
            totalAmount += itemTotal;

            const invoice = new Invoice({
                invoiceId: nextId++,
                ...customerInfo,
                pid: Number(item.pid),
                pname: item.pname,
                opprice: Number(item.opprice),
                quantity: qty,
                totalAmount: itemTotal,
                status: "Pending"
            });

            await invoice.save();
            createdInvoices.push(invoice);
        }

        const responseData = createdInvoices.length === 1
            ? { invoice: createdInvoices[0], totalAmount }
            : { invoices: createdInvoices, totalAmount };

        // Send invoice email (non-blocking)
        if (CEmail) {
            const emailData = createdInvoices.length === 1
                ? createdInvoices[0]
                : { ...customerInfo, invoiceId: nextId - createdInvoices.length, items: createdInvoices, totalAmount, invoiceDate: new Date() };
            sendInvoiceEmail(CEmail, emailData, false);
        }

        res.json({ message: "Invoice created successfully", ...responseData });
    } catch (err) {
        console.log(err);
        res.status(400).json({ error: err.message || "Failed to create invoice" });
    }
});

// =============================
// Create Razorpay Order
// =============================

invoiceRoute.post("/create-razorpay-order", async (req, res) => {
    try {
        const { invoiceId } = req.body;

        // Find invoices by invoiceId (supports comma-separated for multi-item)
        const ids = String(invoiceId).split(",").map(s => Number(s.trim()));
        const invoices = await Invoice.find({ invoiceId: { $in: ids } });

        if (invoices.length === 0) {
            return res.status(404).json({ error: "Invoice not found" });
        }

        const totalAmount = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
        const amountInPaise = Math.round(totalAmount * 100);

        const options = {
            amount: amountInPaise,
            currency: "INR",
            receipt: `invoice_${ids.join("_")}`,
        };

        const order = await razorpay.orders.create(options);

        res.json({
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message || "Failed to create Razorpay order" });
    }
});

// =============================
// Verify Payment
// =============================

invoiceRoute.post("/verify-payment", async (req, res) => {
    try {
        const { invoiceId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        if (!invoiceId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ error: "Missing payment verification fields" });
        }

        // Verify signature
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest("hex");

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ error: "Invalid payment signature" });
        }

        // Update invoice(s) status to Paid
        const ids = String(invoiceId).split(",").map(s => Number(s.trim()));
        const invoices = await Invoice.find({ invoiceId: { $in: ids } });

        for (const inv of invoices) {
            inv.status = "Paid";
            await inv.save();
        }

        // Send payment confirmation email
        if (invoices.length > 0 && invoices[0].CEmail) {
            const totalAmount = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
            const emailData = invoices.length === 1
                ? invoices[0]
                : { ...invoices[0].toObject(), invoiceId, items: invoices, totalAmount };
            sendInvoiceEmail(invoices[0].CEmail, emailData, true);
        }

        res.json({ message: "Payment verified successfully", status: "Paid" });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message || "Payment verification failed" });
    }
});

// =============================
// Show Invoices
// =============================

invoiceRoute.get("/show", async (req, res) => {
    try {
        const data = await Invoice.find().sort({ invoiceId: -1 });
        res.send(data);
    } catch (err) {
        res.status(500).send("Error fetching invoices");
    }
});

invoiceRoute.get("/showbycustomer/:CId", async (req, res) => {
    try {
        const data = await Invoice.find({ CId: Number(req.params.CId) }).sort({ invoiceId: -1 });
        res.send(data);
    } catch (err) {
        res.status(500).send("Error fetching invoices");
    }
});

invoiceRoute.get("/getmaxinvoiceid", async (req, res) => {
    try {
        const invoices = await Invoice.find().sort({ invoiceId: -1 }).limit(1);
        if (invoices.length > 0) {
            res.json({ maxInvoiceId: invoices[0].invoiceId, nextInvoiceId: invoices[0].invoiceId + 1 });
        } else {
            res.json({ maxInvoiceId: 0, nextInvoiceId: 1 });
        }
    } catch (err) {
        res.status(500).json({ error: "Error fetching max invoice ID" });
    }
});

module.exports = invoiceRoute;
