const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// MongoDB connection
mongoose.connect("mongodb://127.0.0.1:27017/jimishoots");
const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => console.log("Connected to MongoDB"));

// Booking schema
const bookingSchema = new mongoose.Schema({
  date: String, // ISO date string
  bookingType: String,
  timeSlot: String,
  customTime: String,
  expiresAt: Number, // timestamp for hold expiration
  status: { type: String, default: "held" }, // "held" or "confirmed"
  amount: Number, // amount in kobo
  reference: String, // Paystack reference
});

const Booking = mongoose.model("Booking", bookingSchema);

// Routes

// 1. Get taken dates
app.get("/api/bookings/taken", async (req, res) => {
  const bookings = await Booking.find({ status: "confirmed" });
  const takenDates = bookings.map((b) => b.date.split("T")[0]);
  res.json(takenDates);
});

// 2. Hold a booking
app.post("/api/bookings/hold", async (req, res) => {
  const { date, bookingType, timeSlot, customTime, amount } = req.body;

  const existing = await Booking.findOne({ date, status: "confirmed" });
  if (existing) return res.status(400).json({ message: "Date already booked" });

  const expiresAt = Date.now() + 2 * 60 * 60 * 1000; // 2 hours
  const booking = new Booking({
    date,
    bookingType,
    timeSlot,
    customTime,
    expiresAt,
    status: "held",
    amount: amount || 5000,
  });

  await booking.save();
  res.json({ message: "Booking held", booking });
});

// 3. Confirm booking (with Paystack verification)
app.post("/api/bookings/confirm/:id", async (req, res) => {
  const { reference } = req.body; // Paystack reference from frontend
  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  if (!reference) return res.status(400).json({ message: "Paystack reference required" });

  try {
    // Verify payment with Paystack
    const PAYSTACK_SECRET_KEY = "YOUR_PAYSTACK_SECRET_KEY"; // replace with your secret key
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${_SECRET_KEY}` },
    });

    const { status, amount: paidAmount } = response.data.data;

    if (status === "success" && paidAmount >= booking.amount) {
      booking.status = "confirmed";
      booking.reference = reference;
      await booking.save();
      res.json({ message: "Booking confirmed after payment verification", booking });
    } else {
      res.status(400).json({ message: "Payment verification failed or amount mismatch" });
    }
  } catch (err) {
    console.error("Paystack verification error:", err.message);
    res.status(500).json({ message: "Error verifying payment with Paystack" });
  }
});

// Cleanup expired holds
setInterval(async () => {
  const now = Date.now();
  await Booking.deleteMany({ status: "held", expiresAt: { $lte: now } });
  console.log("Expired holds cleaned up");
}, 60 * 1000);

// Start server
const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));