const express = require("express");
const vendorRoute = express.Router();

const Vendor = require("./vendor.model");

const multer = require("multer");
const nodemailer = require("nodemailer");
const cloudinary = require("cloudinary").v2;

// =============================
// Cloudinary Configuration
// =============================

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});

// =============================
// Multer Configuration
// =============================

const upload = multer({
  storage: multer.memoryStorage(),
});

// =============================
// Cloudinary Upload Function
// =============================

async function uploadToCloudinary(buffer, filename) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "vendor_images",
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

// =============================
// Vendor Login
// =============================
vendorRoute.post("/login", async (req, res) => {
  try {
    const { VUserId, VUserPass } = req.body;

    const vendor = await Vendor.findOne({
      VUserId: VUserId,
      VUserPass: VUserPass,
    });

    if (!vendor) {
      return res.status(401).send("Invalid User ID or Password");
    }

    res.send(vendor);
  } catch (err) {
    console.log(err);
    res.status(500).send("Login Failed");
  }
});

// =============================
// Get All Vendors (for duplicate checking)
// =============================
vendorRoute.get("/getvendorcount", async (req, res) => {
  try {
    const vendors = await Vendor.find({}, "VUserId VEmail VendorName VId Status");
    res.send(vendors);
  } catch (err) {
    console.log(err);
    res.status(500).send("Failed to fetch vendors");
  }
});

// =============================
// Vendor Registration
// =============================
vendorRoute.post("/register", upload.single('file'), async (req, res) => {
  try {

    const body = req.body || {};

    // helper: case-insensitive lookup + simple token match
    const lowerMap = Object.keys(body).reduce((acc, k) => {
      acc[k.toLowerCase()] = k;
      return acc;
    }, {});

    const getField = (variants, tokens) => {
      for (const v of variants) {
        if (body[v] !== undefined) return body[v];
        const key = lowerMap[v.toLowerCase()];
        if (key) return body[key];
      }
      if (tokens && tokens.length) {
        for (const k of Object.keys(body)) {
          const lk = k.toLowerCase();
          if (tokens.every(t => lk.includes(t))) return body[k];
        }
      }
      return undefined;
    };

    const VUserId = getField(['VUserId','vuserid','userId'], ['user','id']);
    const VUserPass = getField(['VUserPass','vuserpass','password'], ['pass','word']);
    const VendorName = getField(['VendorName','vendorName','vendername','vendernam'], ['vendor','name']);
    const VEmail = getField(['VEmail','vemail','email'], ['email']);
    const VAddress = getField(['VAddress','vaddress','address'], ['address','addr']);
    const VContact = getField(['VContact','vcontact','contact','phone'], ['contact','phone']);

    if (!VUserId || !VUserPass || !VendorName || !VEmail) {
      return res.status(400).send('User ID, Password, Vendor Name, and Email are required');
    }

    const existingVendor = await Vendor.findOne({
      $or: [
        { VUserId: VUserId },
        { VEmail: VEmail }
      ]
    });

    if (existingVendor) {
      return res.status(400).send('User ID or Email already exists');
    }

    const lastVendor = await Vendor.findOne().sort({ VId: -1 });
    const newVId = lastVendor ? lastVendor.VId + 1 : 1;

    // upload file if present
    let picUrl = '';
    if (req.file) {
      try {
        picUrl = await uploadToCloudinary(req.file.buffer, req.file.originalname);
        if (picUrl) console.log('Cloudinary uploaded:', picUrl);
      } catch (e) {
        console.error('Cloudinary upload failed:', e && e.message ? e.message : e);
      }
    }

    const vendor = new Vendor({
      VUserId,
      VUserPass,
      VendorName,
      VAddress: VAddress || '',
      VContact: VContact || '',
      VEmail,
      VPicName: picUrl,
      VId: newVId,
      Status: 'Inactive'
    });

    console.log('=================================');
    console.log('VENDOR OBJECT:');
    console.log(vendor);
    console.log('=================================');

    await vendor.save();
    // send registration email (non-blocking)
    try { sendGMail(vendor.VEmail); } catch (e) { console.error('sendGMail error:', e && e.message ? e.message : e); }

    res.send('Registration Successful');

  } catch (err) {
    console.log('=================================');
    console.log('FULL ERROR:');
    console.log(err);
    console.log('=================================');
    res.status(400).send(err.message || 'Registration Failed');
  }
});
// =============================
// Update Vendor Status
// =============================

vendorRoute.put(
  "/Vendermanage/:vid/:status",
  async (req, res) => {
    try {
      await Vendor.updateOne(
        {
          VId: req.params.vid,
        },
        {
          Status: req.params.status,
        }
      );

      res.send(
        "Vendor Status Updated Successfully"
      );
    } catch (err) {
      console.log(err);
      res
        .status(500)
        .send("Status Update Failed");
    }
  }
);

// =============================
// Update Vendor Profile
// =============================

vendorRoute.put(
  "/update/:VUserId",
  upload.single("file"),
  async (req, res) => {
    try {
      const vendor =
        await Vendor.findOne({
          VUserId:
            req.params.VUserId,
        });

      if (!vendor) {
        return res
          .status(404)
          .send("Vendor Not Found");
      }

      let imageUrl =
        vendor.VPicName;

      if (req.file) {
        imageUrl =
          await uploadToCloudinary(
            req.file.buffer,
            req.file.originalname
          );
      }

      const updatedData = {
        VendorName:
          req.body.VendorName ||
          vendor.VendorName,

        VAddress:
          req.body.VAddress ||
          vendor.VAddress,

        VContact:
          req.body.VContact ||
          vendor.VContact,

        VEmail:
          req.body.VEmail ||
          vendor.VEmail,

        VPicName: imageUrl,
      };

      await Vendor.updateOne(
        {
          VUserId:
            req.params.VUserId,
        },
        {
          $set: updatedData,
        }
      );

      res.send({
        message:
          "Profile Updated Successfully",
        updatedData,
      });
    } catch (err) {
      console.log(err);
      res
        .status(500)
        .send("Profile Update Failed");
    }
  }
);

// =============================
// OTP Storage
// =============================

let otpStore = {};

// =============================
// Mail Configuration
// =============================

// Support multiple env var names for Gmail credentials
const emailUser = process.env.EMAIL || process.env.GMAIL_USER || process.env.GMAIL_EMAIL;
const emailPass = process.env.EMAIL_PASSWORD || process.env.GMAIL_APP_PASS || process.env.GMAIL_PASS;

const transporter =
  nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: emailUser,
      pass: emailPass,
    },
  });

// Verify transporter once at startup to detect auth/config issues early
let emailServiceAvailable = true;
transporter.verify()
  .then(() => {
    console.log('✅ Email transporter verified');
  })
  .catch((err) => {
    emailServiceAvailable = false;
    console.error('❌ Email transporter verification failed:', err && err.message ? err.message : err);
    console.error('Emails will be disabled until SMTP settings are fixed.');
  });

// =============================
// Send OTP
// =============================

vendorRoute.post(
  "/sendotp",
  async (req, res) => {
    try {
        if (!emailServiceAvailable) {
          return res.status(503).send('Email service not available');
        }
        const { email } = req.body;

      const vendor =
        await Vendor.findOne({
          VEmail: email,
        });

      if (!vendor) {
        return res
          .status(404)
          .send("Email Not Found");
      }

      const otp = Math.floor(
        100000 +
          Math.random() * 900000
      );

      otpStore[email] = otp;

      try {
        await transporter.sendMail({
          from: emailUser,
          to: email,
          subject: "Password Reset OTP",
          text: `Your OTP is ${otp}`,
        });
      } catch (e) {
        console.error('sendMail error:', e && e.message ? e.message : e);
        if (e && (e.code === 'EAUTH' || /auth/i.test(e.message || ''))) {
          emailServiceAvailable = false;
          return res.status(503).send('Email service authentication failed');
        }
        return res.status(500).send('Failed To Send OTP');
      }

      res.send("OTP Sent");
    } catch (err) {
      console.log(err);
      res
        .status(500)
        .send("Failed To Send OTP");
    }
  }
);

// =============================
// Verify OTP
// =============================

vendorRoute.post(
  "/verifyotp",
  (req, res) => {
    const { email, otp } =
      req.body;

    if (
      otpStore[email] &&
      otpStore[email] ==
        otp
    ) {
      return res.send(
        "OTP Verified"
      );
    }

    res
      .status(400)
      .send("Invalid OTP");
  }
);

// =============================
// Reset Password
// =============================

vendorRoute.put(
  "/resetpassword",
  async (req, res) => {
    try {
      const {
        email,
        password,
      } = req.body;

      await Vendor.updateOne(
        {
          VEmail: email,
        },
        {
          VUserPass: password,
        }
      );

      delete otpStore[email];

      res.send(
        "Password Updated Successfully"
      );
    } catch (err) {
      console.log(err);
      res
        .status(500)
        .send(
          "Password Update Failed"
        );
    }
  }
);



/*
====================================================
                EMAIL FUNCTION
====================================================
*/

function sendGMail(mailto) {
  // Prefer the already-configured transporter; otherwise create a local one
  const localTransporter = transporter || nodemailer.createTransport({
    service: 'gmail',
    auth: { user: emailUser, pass: emailPass },
  });

  // send and handle errors gracefully
  localTransporter.sendMail({
    from: emailUser,
    to: mailto,
    subject: 'Vendor Registration Successful',
    text: 'Dear Vendor, your registration is successful. Admin approval is required before login.'
  }).then(() => {
    console.log('mail sent to vendor', mailto);
  }).catch((e) => {
    console.error('sendGMail error:', e && e.message ? e.message : e);
    if (e && (e.code === 'EAUTH' || /auth/i.test(e.message || ''))) {
      emailServiceAvailable = false;
    }
  });
}

module.exports = vendorRoute;