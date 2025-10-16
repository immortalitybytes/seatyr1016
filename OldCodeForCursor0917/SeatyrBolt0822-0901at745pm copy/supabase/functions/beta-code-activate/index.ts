import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Parse request body
    const { userId, betaCode } = await req.json();

    if (!userId || !betaCode) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // First check if this beta code is in the valid_beta_codes_ui table
    const { data: validCode, error: validCodeError } = await supabase
      .from('valid_beta_codes_ui')
      .select('code')
      .eq('code', betaCode)
      .single();
      
    if (validCodeError || !validCode) {
      return new Response(JSON.stringify({ error: "Invalid beta code" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Now verify the beta code exists and is valid
    const { data: code, error: codeError } = await supabase
      .from('beta_codes')
      .select('*')
      .eq('code', betaCode)
      .single();

    if (codeError || !code) {
      return new Response(JSON.stringify({ error: "Invalid beta code" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if code is expired
    if (code.expires_on && new Date(code.expires_on) < new Date()) {
      return new Response(JSON.stringify({ error: "Beta code has expired" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if maximum uses reached
    if (code.max_uses && code.uses >= code.max_uses) {
      return new Response(JSON.stringify({ error: "Beta code has reached maximum usage" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user already has an active trial
    const { data: existingTrial, error: trialError } = await supabase
      .from('trial_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('expires_on', { ascending: false })
      .limit(1);

    if (trialError) {
      return new Response(JSON.stringify({ error: "Error checking for existing trial" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (existingTrial && existingTrial.length > 0 && new Date(existingTrial[0].expires_on) > new Date()) {
      return new Response(JSON.stringify({ error: "User already has an active trial" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create the trial expiration date (30 days from now)
    const expiresOn = new Date();
    expiresOn.setDate(expiresOn.getDate() + 30);

    // Create the trial subscription
    const { data: trial, error: createError } = await supabase
      .from('trial_subscriptions')
      .insert({
        user_id: userId,
        trial_code: betaCode,
        start_date: new Date().toISOString(),
        expires_on: expiresOn.toISOString()
      })
      .select()
      .single();

    if (createError) {
      return new Response(JSON.stringify({ error: "Error creating trial subscription" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Increment the uses count for the beta code
    await supabase
      .from('beta_codes')
      .update({ uses: code.uses + 1 })
      .eq('code', betaCode);

    return new Response(JSON.stringify({ 
      success: true,
      trial,
      message: "Beta code activated successfully"
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error activating beta code:", error);
    
    return new Response(
      JSON.stringify({ error: error.message || "Failed to activate beta code" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});