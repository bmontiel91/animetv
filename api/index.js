require("dotenv").config();
const path = require("node:path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const animeRoutes = require("../src/routes/anime.routes");
const tvRoutes = require("../src/routes/tv.routes");
const { ApiError } = require("../src/utils/api-error");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

// Serve frontend
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_req, res) => {
  res.status(200).json({ success: true, status: "ok" });
});

app.use("/api/v1/anime", animeRoutes);
app.use("/api/anime1v", animeRoutes);
app.use("/api/v1/tv", tvRoutes);

app.use((_req, _res, next) => {
  next(new ApiError(404, "Endpoint no encontrado"));
});

app.use((error, _req, res, _next) => {
  const statusCode = error.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: error.message || "Error interno del servidor",
  });
});

module.exports = app;
