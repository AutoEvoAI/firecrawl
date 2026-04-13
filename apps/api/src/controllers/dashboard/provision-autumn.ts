import { Request, Response } from "express";
import { DashboardAuthRequest } from "../../lib/dashboard-auth";
import { autumnService } from "../../services/autumn/autumn.service";

export async function provisionAutumn(req: DashboardAuthRequest, res: Response) {
  try {
    const { orgId, teamId, orgName, teamName, email } = req.body;

    if (!orgId || !teamId) {
      return res.status(400).json({ error: "orgId and teamId are required" });
    }

    // Provision organization in Autumn
    await autumnService.ensureOrgProvisioned({
      orgId,
      name: orgName,
      email,
    });

    // Provision team in Autumn
    await autumnService.ensureTeamProvisioned({
      teamId,
      orgId,
      name: teamName,
    });

    res.json({ success: true, message: "Autumn provisioning successful" });
  } catch (error) {
    console.error("Autumn provisioning error:", error);
    res.status(500).json({ error: "Failed to provision Autumn" });
  }
}
