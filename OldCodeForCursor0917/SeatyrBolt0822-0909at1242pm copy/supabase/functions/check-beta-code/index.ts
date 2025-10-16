import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get request body
    const { code, userId } = await req.json();

    if (!code || !userId) {
      return new Response(
        JSON.stringify({ error: "Code and userId are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // First check if code is in the valid_beta_codes_ui table
    const { data: validUICode, error: validUICodeError } = await supabase
      .from("valid_beta_codes_ui")
      .select("code")
      .eq("code", code)
      .single();
      
    if (validUICodeError || !validUICode) {
      return new Response(
        JSON.stringify({ error: "Invalid beta code" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if code exists and is valid
    const { data: betaCode, error: betaCodeError } = await supabase
      .from("beta_codes")
      .select("*")
      .eq("code", code)
      .single();

    if (betaCodeError || !betaCode) {
      return new Response(
        JSON.stringify({ error: "Invalid beta code" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if code is expired
    if (betaCode.expires_on && new Date(betaCode.expires_on) < new Date()) {
      return new Response(
        JSON.stringify({ error: "Beta code has expired" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if code has reached max uses
    if (betaCode.max_uses && betaCode.uses >= betaCode.max_uses) {
      return new Response(
        JSON.stringify({ error: "Beta code has reached maximum uses" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if user already has an active trial
    const { data: existingTrial } = await supabase
      .from("trial_subscriptions")
      .select("*")
      .eq("user_id", userId)
      .gt("expires_on", new Date().toISOString())
      .maybeSingle();

    if (existingTrial) {
      return new Response(
        JSON.stringify({ error: "User already has an active trial" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create trial subscription
    const trialExpires = new Date();
    trialExpires.setDate(trialExpires.getDate() + 30); // 30-day trial

    const { error: trialError } = await supabase
      .from("trial_subscriptions")
      .insert({
        user_id: userId,
        trial_code: code,
        start_date: new Date().toISOString(),
        expires_on: trialExpires.toISOString(),
      });

    if (trialError) {
      return new Response(
        JSON.stringify({ error: "Error creating trial subscription" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Increment the uses count for the beta code
    await supabase
      .from("beta_codes")
      .update({ uses: (betaCode.uses || 0) + 1 })
      .eq("code", code);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Beta code activated successfully",
        expiresOn: trialExpires.toISOString()
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error processing request:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});