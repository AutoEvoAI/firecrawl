import { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { config } from "../../config";
import { DashboardAuthRequest } from "../../lib/dashboard-auth";
import { randomBytes } from "crypto";
import { v4 as uuidv4 } from "uuid";

const supabase = createClient(
  config.SUPABASE_URL || "",
  config.SUPABASE_SERVICE_TOKEN || "",
);

export async function getApiKeys(req: DashboardAuthRequest, res: Response) {
  try {
    const { teamId } = req.auth!;

    const { data: apiKeys, error } = await supabase
      .from("api_keys")
      .select("id, key_value, name, created_at")
      .eq("team_id", teamId)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Mask the key values
    const maskedKeys = apiKeys?.map((key: any) => ({
      ...key,
      key_value: maskApiKey(key.key_value),
    })) || [];

    res.json({ apiKeys: maskedKeys });
  } catch (error) {
    console.error("Get API keys error:", error);
    res.status(500).json({ error: "Failed to fetch API keys" });
  }
}

export async function createApiKey(req: DashboardAuthRequest, res: Response) {
  try {
    const { teamId, userId } = req.auth!;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const { data: apiKey, error } = await supabase
      .from("api_keys")
      .insert({
        key_value: generateApiKey(),
        name,
        team_id: teamId,
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Return the full key only on creation
    res.json({ apiKey: { ...apiKey, key_value: apiKey.key_value } });
  } catch (error) {
    console.error("Create API key error:", error);
    res.status(500).json({ error: "Failed to create API key" });
  }
}

export async function deleteApiKey(req: DashboardAuthRequest, res: Response) {
  try {
    const { teamId } = req.auth!;
    const { id } = req.params;

    // Verify ownership
    const { data: apiKey } = await supabase
      .from("api_keys")
      .select("team_id")
      .eq("id", id)
      .single();

    if (!apiKey || apiKey.team_id !== teamId) {
      return res.status(403).json({ error: "API key not found or access denied" });
    }

    const { error } = await supabase
      .from("api_keys")
      .delete()
      .eq("id", id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Delete API key error:", error);
    res.status(500).json({ error: "Failed to delete API key" });
  }
}

export async function updateApiKey(req: DashboardAuthRequest, res: Response) {
  try {
    const { teamId } = req.auth!;
    const { id } = req.params;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    // Verify ownership
    const { data: apiKey } = await supabase
      .from("api_keys")
      .select("team_id")
      .eq("id", id)
      .single();

    if (!apiKey || apiKey.team_id !== teamId) {
      return res.status(403).json({ error: "API key not found or access denied" });
    }

    const { data: updatedKey, error } = await supabase
      .from("api_keys")
      .update({ name })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ apiKey: { ...updatedKey, key_value: maskApiKey(updatedKey.key_value) } });
  } catch (error) {
    console.error("Update API key error:", error);
    res.status(500).json({ error: "Failed to update API key" });
  }
}

function maskApiKey(key: string): string {
  if (key.length <= 12) {
    return "****";
  }
  return `${key.substring(0, 8)}****${key.substring(key.length - 4)}`;
}

function generateApiKey(): string {
  // Generate a UUID-based API key that matches parseApi validation logic
  const uuid = uuidv4().replace(/-/g, "");
  return `fc-${uuid}`;
}
