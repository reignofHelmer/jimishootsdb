require("dotenv").config();
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
const bookingSchema = new mongoose.Schema(
  {
    date: String,
    bookingType: String,
    timeSlot: String,
    customTime: String,
    amount: Number,
    customer: {
      name: String,
      email: String,
      phone: String
    },
    expiresAt: Number,
    status: { type: String, default: "held" },
    reference: String
  },
  { timestamps: true }
);

const Booking = mongoose.model("Booking", bookingSchema);

// ======================= ROUTES =======================

// 1️⃣ Get taken dates
app.get("/api/bookings/taken", async (req, res) => {
  const bookings = await Booking.find({ status: "confirmed" });
  const takenDates = bookings.map(b => b.date.split("T")[0]);
  res.json(takenDates);
});

// 2️⃣ Hold booking
app.post("/api/bookings/hold", async (req, res) => {
  const { date, bookingType, timeSlot, customTime, amount, customer } = req.body;

  const existing = await Booking.findOne({
    date,
    status: { $in: ["held", "confirmed"] },
  });

  if (existing) {
    return res.status(400).json({ message: "Date already reserved" });
  }

  const booking = new Booking({
    date,
    bookingType,
    timeSlot,
    customTime,
    amount,
    customer,
    status: "held",
    expiresAt: Date.now() + 2 * 60 * 60 * 1000,
  });


  await booking.save();
  res.json({ message: "Booking held", booking });
});
// little divergent
app.get("/api/bookings/all", async (req, res) => {
  const bookings = await Booking.find().sort({ createdAt: -1 });
  res.json(bookings);
});

// 3️⃣ Confirm booking after Paystack verification
app.post("/api/bookings/confirm/:id", async (req, res) => {
  console.log("BOOKING CONFIRMED:", booking);
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
      payment.status === "success" &&
      payment.amount === booking.amount * 100 &&
      payment.currency === "NGN"
    ) {
      booking.status = "confirmed";
      booking.reference = reference;
      await booking.save();

      return res.json({
        message: "Booking confirmed successfully",
        booking,
      });
    }

    return res.status(400).json({
      message: "Payment verification failed",
    });
  } catch (err) {
    console.error(err.message);
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