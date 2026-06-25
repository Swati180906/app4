const express = require("express");
const adminRoute = express.Router();

const Vendor = require("../vendor/vendor.model");
const Customer = require("../customer/customer.model");

const ADMIN_USER = "admin";
const ADMIN_PASS = "admin123";

adminRoute.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.send({ username, role: "admin", message: "Login Successful" });
  }
  res.status(401).send("Invalid Admin Credentials");
});

adminRoute.get("/vendors", async (req, res) => {
  try {
    const vendors = await Vendor.find({}, "VUserId VendorName VEmail VContact VId Status VPicName");
    res.send(vendors);
  } catch (err) {
    console.log(err);
    res.status(500).send("Failed to fetch vendors");
  }
});

adminRoute.get("/customers", async (req, res) => {
  try {
    const customers = await Customer.find({}, "CUserId CustomerName CEmail CContact CId Status CPicName");
    res.send(customers);
  } catch (err) {
    console.log(err);
    res.status(500).send("Failed to fetch customers");
  }
});

module.exports = adminRoute;
