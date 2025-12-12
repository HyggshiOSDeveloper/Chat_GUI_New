import express from "express";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGO_URI);
const dbName = "roblox_accounts";
let db;

// 🧠 Kết nối MongoDB
async function connectDB() {
  try {
    await client.connect();
    db = client.db(dbName);
    console.log("✅ Đã kết nối tới MongoDB Atlas!");
  } catch (err) {
    console.error("❌ Lỗi kết nối MongoDB:", err);
  }
}
connectDB();

// 🧩 ROUTES

// Lấy tất cả tài khoản
app.get("/accounts", async (req, res) => {
  const accounts = await db.collection("accounts").find().toArray();
  res.json(accounts);
});

// Thêm tài khoản mới
app.post("/accounts", async (req, res) => {
  const newAccount = req.body;
  await db.collection("accounts").insertOne(newAccount);
  res.json({ message: "✅ Đã thêm tài khoản mới", data: newAccount });
});

// Xóa tài khoản theo username
app.delete("/accounts/:username", async (req, res) => {
  const { username } = req.params;
  await db.collection("accounts").deleteOne({ username });
  res.json({ message: `🗑️ Đã xóa tài khoản ${username}` });
});

// Kiểm tra API
app.get("/", (req, res) => {
  res.send("🌐 Roblox Account API đang hoạt động!");
});

// Chạy server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server đang chạy tại http://localhost:${port}`));
