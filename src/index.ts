#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "mcp-noaa", version: "1.0.0" });
const UA = "SkywalkerAgent chris.sellers01@gmail.com";

async function noaaApi(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/geo+json" } });
  if (!res.ok) throw new Error(`NOAA API ${res.status}: ${await res.text()}`);
  return res.json();
}

server.tool("get_forecast", "Get weather forecast for a location (US only)", {
  lat: z.number().describe("Latitude"),
  lon: z.number().describe("Longitude"),
}, async ({ lat, lon }) => {
  const point = await noaaApi(`https://api.weather.gov/points/${lat},${lon}`);
  const forecast = await noaaApi(point.properties.forecast);
  const periods = forecast.properties.periods.slice(0, 7);
  return { content: [{ type: "text", text: JSON.stringify(periods, null, 2) }] };
});

server.tool("get_alerts", "Get active weather alerts for a US state or area", {
  state: z.string().optional().describe("Two-letter state code (e.g., CA, TX)"),
  area: z.string().optional().describe("Area code"),
  severity: z.enum(["Extreme", "Severe", "Moderate", "Minor"]).optional(),
  limit: z.number().default(10),
}, async ({ state, area, severity, limit }) => {
  const url = new URL("https://api.weather.gov/alerts/active");
  if (state) url.searchParams.set("area", state);
  if (area) url.searchParams.set("area", area);
  if (severity) url.searchParams.set("severity", severity);
  url.searchParams.set("limit", String(limit));
  const data = await noaaApi(url.toString());
  const alerts = (data.features || []).map((f: any) => ({
    headline: f.properties.headline,
    severity: f.properties.severity,
    event: f.properties.event,
    description: f.properties.description?.slice(0, 500),
    areas: f.properties.areaDesc,
    onset: f.properties.onset,
    expires: f.properties.expires,
  }));
  return { content: [{ type: "text", text: JSON.stringify(alerts, null, 2) }] };
});

server.tool("get_stations", "Get weather observation stations near a point", {
  lat: z.number().describe("Latitude"),
  lon: z.number().describe("Longitude"),
  limit: z.number().default(5),
}, async ({ lat, lon, limit }) => {
  const point = await noaaApi(`https://api.weather.gov/points/${lat},${lon}`);
  const stations = await noaaApi(point.properties.observationStations);
  const results = (stations.features || []).slice(0, limit).map((f: any) => ({
    id: f.properties.stationIdentifier,
    name: f.properties.name,
    elevation: f.properties.elevation?.value,
  }));
  return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
});

server.tool("get_observations", "Get latest observation from a weather station", {
  station_id: z.string().describe("Station ID (e.g., KLAX, KJFK)"),
}, async ({ station_id }) => {
  const data = await noaaApi(`https://api.weather.gov/stations/${station_id}/observations/latest`);
  const p = data.properties;
  return { content: [{ type: "text", text: JSON.stringify({
    timestamp: p.timestamp, description: p.textDescription,
    temperature_c: p.temperature?.value, humidity: p.relativeHumidity?.value,
    wind_speed_kmh: p.windSpeed?.value, wind_direction: p.windDirection?.value,
    barometric_pressure: p.barometricPressure?.value,
    visibility_m: p.visibility?.value,
  }, null, 2) }] };
});

server.tool("climate_normals", "Get climate data from NOAA Climate Data Online", {
  dataset_id: z.string().default("GHCND").describe("Dataset (GHCND, GSOM, GSOY)"),
  station_id: z.string().describe("Station ID (e.g., GHCND:USW00023174)"),
  start_date: z.string().describe("Start date (YYYY-MM-DD)"),
  end_date: z.string().describe("End date (YYYY-MM-DD)"),
  data_types: z.string().optional().describe("Comma-separated data types (TMAX,TMIN,PRCP)"),
  limit: z.number().default(25),
}, async ({ dataset_id, station_id, start_date, end_date, data_types, limit }) => {
  const token = process.env.NOAA_CDO_TOKEN;
  if (!token) throw new Error("NOAA_CDO_TOKEN required for Climate Data Online");
  const url = new URL("https://www.ncdc.noaa.gov/cdo-web/api/v2/data");
  url.searchParams.set("datasetid", dataset_id);
  url.searchParams.set("stationid", station_id);
  url.searchParams.set("startdate", start_date);
  url.searchParams.set("enddate", end_date);
  url.searchParams.set("limit", String(limit));
  if (data_types) url.searchParams.set("datatypeid", data_types);
  const res = await fetch(url.toString(), { headers: { token } });
  const data = await res.json();
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
