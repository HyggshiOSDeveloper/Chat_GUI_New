import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const client = new MongoClient(process.env.MONGO_URI);

async function connectDB() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas!");
  } catch (err) {
    console.error("❌ MongoDB Error:", err);
  }
}

connectDB();
