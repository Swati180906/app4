const express = require("express");
const productRoute = express.Router();
const Product = require("./product.model");
const cloudinary = require("cloudinary").v2;
const multer = require("multer");

require("dotenv").config();

/* ================= CLOUDINARY ================= */

cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUD_API_KEY,
    api_secret: process.env.CLOUD_API_SECRET,
});

/* ================= MULTER ================= */

const upload = multer({ storage: multer.memoryStorage() });

/* ================= CLOUDINARY UPLOAD FUNCTION ================= */

async function uploadToCloudinary(buffer, filename) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder: "product_images",
                public_id: Date.now() + "-" + filename,
            },
            (err, result) => {
                if (err) reject(err);
                else resolve(result.secure_url);
            }
        );
        stream.end(buffer);
    });
}

/* ================= SAVE PRODUCT WITH IMAGE ================= */

productRoute.post("/saveproduct", upload.single("file"), async (req, res) => {
    try {
        const body = req.body || {};

        const { pid, pname, ppprice, opprice, pcatgid, vid, status, pdesc } = body;

        if (!pid || !pname || !ppprice || !opprice) {
            return res.status(400).json({
                error: "Product ID, Name, Wholesale Price, and Retail Price are required"
            });
        }

        let ppicname = '';
        if (req.file) {
            try {
                ppicname = await uploadToCloudinary(req.file.buffer, req.file.originalname);
            } catch (e) {
                console.error("Cloudinary upload failed:", e && e.message ? e.message : e);
            }
        }

        const product = new Product({
            pid: Number(pid),
            pname,
            ppprice: Number(ppprice),
            opprice: Number(opprice),
            ppicname,
            pcatgid: pcatgid ? Number(pcatgid) : undefined,
            vid: vid ? Number(vid) : undefined,
            status: status || "Inactive",
            pdesc: pdesc || "This is a Branded Company Product"
        });

        await product.save();

        res.json({
            message: "Product added successfully",
            product,
        });
    }
    catch (err) {
        console.log(err);
        res.status(400).json({
            error: err.message || "Failed to save product"
        });
    }
});

/* ================= UPLOAD IMAGE ONLY ================= */

productRoute.post(
    "/saveproductimage",
    upload.single("file"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: "No file" });
            }

            const imageUrl = await uploadToCloudinary(req.file.buffer, req.file.originalname);

            res.json({ imageUrl });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Image upload failed" });
        }
    }
);

/* ================= FETCH ================= */

productRoute.get(
    "/showproductbyvendor/:vid",
    async (req, res) => {
        try {
            const data = await Product.find({
                vid: Number(req.params.vid),
            });
            res.send(data);
        } catch (err) {
            res.status(500).send("Error fetching products");
        }
    }
);

productRoute.get(
    "/showproduct",
    async (req, res) => {
        try {
            const data = await Product.find();
            res.send(data);
        } catch (err) {
            res.status(500).send("Error fetching products");
        }
    }
);

productRoute.get(
    "/showproductbycatgid/:pcatgid",
    async (req, res) => {
        try {
            const data = await Product.find({
                pcatgid: Number(req.params.pcatgid),
            });
            res.send(data);
        } catch (err) {
            res.status(500).send("Error fetching products");
        }
    }
);

productRoute.get(
    "/showproductbystatus/:status",
    async (req, res) => {
        try {
            const data = await Product.find({
                status: req.params.status,
            });
            res.send(data);
        } catch (err) {
            res.status(500).send("Error fetching products");
        }
    }
);

/* ================= GET MAX PRODUCT ID ================= */

productRoute.get(
    "/getmaxpid",
    async (req, res) => {
        try {
            const products = await Product.find().sort({ pid: -1 }).limit(1);
            
            if (products.length > 0) {
                res.json({ maxPid: products[0].pid, nextPid: products[0].pid + 1 });
            } else {
                res.json({ maxPid: 0, nextPid: 1 });
            }
        } catch (err) {
            res.status(500).json({ error: "Error fetching max product ID" });
        }
    }
);

/* ================= UPDATE ================= */

productRoute.put(
    "/updateproduct/:pid",
    upload.single("file"),
    async (req, res) => {
        try {
            const updateData = { ...req.body };

            if (updateData.pid) updateData.pid = Number(updateData.pid);
            if (updateData.ppprice) updateData.ppprice = Number(updateData.ppprice);
            if (updateData.opprice) updateData.opprice = Number(updateData.opprice);
            if (updateData.pcatgid) updateData.pcatgid = Number(updateData.pcatgid);
            if (updateData.vid) updateData.vid = Number(updateData.vid);

            if (req.file) {
                try {
                    updateData.ppicname = await uploadToCloudinary(req.file.buffer, req.file.originalname);
                } catch (e) {
                    console.error("Cloudinary upload failed:", e && e.message ? e.message : e);
                }
            }

            await Product.updateOne(
                { pid: Number(req.params.pid) },
                { $set: updateData }
            );

            res.json({ message: "Product updated successfully" });
        } catch (err) {
            res.status(500).json({ error: "Update failed" });
        }
    }
);

productRoute.put(
    "/updateproductstatus/:pid/:status",
    async (req, res) => {
        try {
            await Product.updateOne(
                { pid: Number(req.params.pid) },
                { $set: { status: req.params.status } }
            );

            res.json({ message: "Product status updated successfully" });
        } catch (err) {
            res.status(500).json({ error: "Status update failed" });
        }
    }
);

/* ================= DELETE ================= */

productRoute.delete(
    "/deleteproduct/:pid",
    async (req, res) => {
        try {
            await Product.deleteOne({ pid: Number(req.params.pid) });
            res.json({ message: "Product deleted successfully" });
        } catch (err) {
            res.status(500).json({ error: "Delete failed" });
        }
    }
);

module.exports = productRoute;