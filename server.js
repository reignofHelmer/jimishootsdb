require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");
const nodemailer = require("nodemailer"); 

console.log("ADMIN EMAIL ENV:", process.env.ADMIN_EMAIL);

const app = express();
app.use(cors());
app.use(bodyParser.json());
 
const sendEmail = async ({ to, subject, html }) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const info = await transporter.sendMail({
      from: `"JimiShoots" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });

    console.log("✅ Email sent successfully to:", to);
    console.log("Message ID:", info.messageId);
    return info;
  } catch (error) {
    console.error("❌ Email sending failed:", error.message);
    throw error;
  }
};

// MongoDB connection
mongoose.connect("mongodb://127.0.0.1:27017/jimishoots");
const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => console.log("Connected to MongoDB"));

// Booking schema
const bookingSchema = new mongoose.Schema({
  date: String,           // YYYY-MM-DD
  bookingType: String,
  timeSlot: String,
  customTime: String,
  amount: Number,

  customer: {
    name: String,
    email: String,
    phone: String
  },

  status: { type: String, default: "held" },
  expiresAt: Number,
  reference: String
});

const Booking = mongoose.model("Booking", bookingSchema);

// ======================= ROUTES =======================

// Replace your existing routes with these updated versions:

// 1️⃣ Get taken TIME SLOTS for a specific date (not the whole date)
app.get("/api/bookings/slots", async (req, res) => {
  const { date } = req.query;
  
  const bookings = await Booking.find({
    date,
    status: { $in: ["held", "confirmed"] },
  });
  
  // Return array of booked time slots
  const lockedSlots = bookings.map(b => ({
    timeSlot: b.timeSlot || b.customTime,
    bookingType: b.bookingType
  }));
  
  res.json(lockedSlots);
});

// 2️⃣ Hold booking - CHECK FOR TIME CONFLICTS, NOT DATE CONFLICTS
app.post("/api/bookings/hold", async (req, res) => {
  const { date, bookingType, timeSlot, customTime, amount, customer } = req.body;

  const selectedTime = timeSlot || customTime;

  // ✅ Check if the SPECIFIC TIME SLOT is already taken on this date
  const existing = await Booking.findOne({
    date,
    $or: [
      { timeSlot: selectedTime },
      { customTime: selectedTime }
    ],
    status: { $in: ["held", "confirmed"] },
  });

  if (existing) {
    return res.status(400).json({ 
      message: "This time slot is already booked. Please choose another time." 
    });
  }

  // ✅ Validate custom time is within allowed hours (7 AM - 9 PM)
  if (customTime) {
    const timeValidation = validateTimeRange(customTime);
    if (!timeValidation.valid) {
      return res.status(400).json({ message: timeValidation.error });
    }
  }

  const booking = new Booking({
    date,
    bookingType,
    timeSlot,
    customTime,
    amount,
    customer,
    status: "held",
    expiresAt: Date.now() + 2 * 60 * 60 * 1000, // 2 hours
  });

  await booking.save();
  res.json({ message: "Booking held", booking });
});

// ✅ Helper function to validate time range
function validateTimeRange(timeString) {
  // Parse custom time format (e.g., "2:00 PM - 5:00 PM" or "14:00 - 17:00")
  const timeRegex = /(\d{1,2}):(\d{2})\s*(AM|PM)?/gi;
  const matches = [...timeString.matchAll(timeRegex)];
  
  if (matches.length === 0) {
    return { valid: false, error: "Invalid time format. Use format like '2:00 PM - 5:00 PM'" };
  }

  // Convert to 24-hour format
  const convertTo24Hour = (hour, minute, period) => {
    let h = parseInt(hour);
    const m = parseInt(minute);
    
    if (period) {
      if (period.toUpperCase() === 'PM' && h !== 12) h += 12;
      if (period.toUpperCase() === 'AM' && h === 12) h = 0;
    }
    
    return h + (m / 60);
  };

  const times = matches.map(match => {
    return convertTo24Hour(match[1], match[2], match[3]);
  });

  const startTime = Math.min(...times);
  const endTime = Math.max(...times);

  // Check if within 7 AM (7) to 9 PM (21)
  if (startTime < 7) {
    return { valid: false, error: "Bookings cannot start before 7:00 AM" };
  }
  
  if (endTime > 21) {
    return { valid: false, error: "Bookings cannot end after 9:00 PM" };
  }

  return { valid: true };
}

// little divergent
app.get("/api/bookings/all", async (req, res) => {
  const bookings = await Booking.find().sort({ createdAt: -1 });
  res.json(bookings);
});

app.get("/debug-email", async (req, res) => {
  await sendEmail({
    to: "anotheremail@gmail.com", // NOT admin email
    subject: "DEBUG EMAIL",
    html: "<h1>If this arrives, Nodemailer works</h1>",
  });

  res.send("Debug email sent");
});


// 3️⃣ Confirm booking after Paystack verification
app.post("/api/bookings/confirm/:id", async (req, res) => {
  const { reference } = req.body;

  if (!reference) {
    return res.status(400).json({ message: "Payment reference required" });
  }

  const booking = await Booking.findById(req.params.id);
  if (!booking) {
    return res.status(404).json({ message: "Booking not found" });
  }

  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const payment = response.data.data;

    if (
      payment.status !== "success" ||
      payment.amount !== booking.amount * 100 ||
      payment.currency !== "NGN"
    ) {
      return res.status(400).json({ message: "Payment verification failed" });
    }

    // ✅ Confirm booking
    booking.status = "confirmed";
    booking.reference = reference;
    await booking.save();

    // ✅ Customer email
    await sendEmail({
      to: booking.customer.email,
      subject: "📸 Booking Confirmed – JimiShoots",
      html: `
        <h2>Booking Confirmed 🎉</h2>
        <p>Hi ${booking.customer.name},</p>
        <p>Your booking has been confirmed.</p>
        <p><strong>Date:</strong> ${new Date(booking.date).toDateString()}</p>
        <p><strong>Session:</strong> ${booking.bookingType}</p>
        <p><strong>Time:</strong> ${booking.timeSlot || booking.customTime}</p>
        <p><strong>Amount:</strong> ₦${booking.amount.toLocaleString()}</p>
      `,
    });

    // ✅ Admin email
    console.log("SENDING ADMIN MAIL TO:", process.env.ADMIN_EMAIL);
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: "📢 New Booking Confirmed",
      html: `
        <h2>New Booking Alert</h2>
        <ul>
          <li><strong>Name:</strong> ${booking.customer.name}</li>
          <li><strong>Email:</strong> ${booking.customer.email}</li>
          <li><strong>Phone:</strong> ${booking.customer.phone}</li>
          <li><strong>Date:</strong> ${new Date(booking.date).toDateString()}</li>
          <li><strong>Session:</strong> ${booking.bookingType}</li>
          <li><strong>Time:</strong> ${booking.timeSlot || booking.customTime}</li>
          <li><strong>Amount:</strong> ₦${booking.amount.toLocaleString()}</li>
          <li><strong>Reference:</strong> ${reference}</li>
        </ul>
      `,
    });

    return res.json({
      message: "Booking confirmed successfully",
      booking,
    });
  } catch (err) {
    console.error("PAYSTACK VERIFY ERROR:", err.message);
    res.status(500).json({ message: "Payment verification error" });
  }
});


// 4️⃣ Cleanup expired holds
setInterval(async () => {
  await Booking.deleteMany({
    status: "held",
    expiresAt: { $lte: Date.now() },
  });
}, 60 * 1000);

// Server
const PORT = 5000;
app.listen(PORT, () =>
  console.log(`Server running on port ${PORT}`)
);

// ======================= ADMIN =======================

app.get("/api/admin/bookings", async (req, res) => {
  try {
    const bookings = await Booking.find()
      .sort({ createdAt: -1 });

    res.json(bookings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch bookings" });
  }
});