import { supabase } from './supabase';

export const activateBetaCode = async (userId: string, code: string) => {
  if (!userId || !code) {
    throw new Error('User ID and beta code are required');
  }
  
  try {
    // First try calling the edge function
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/beta-code-activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ userId, betaCode: code }),
      });
      
      if (response.ok) {
        const data = await response.json();
        return data;
      }
      
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to activate beta code');
    } catch (error) {
      console.error('Edge function failed, attempting direct database activation', error);
      
      // Fallback to direct database access if edge function fails
      // First check if code is in the valid_beta_codes_ui table
      const { data: validCode, error: validCodeError } = await supabase
        .from('valid_beta_codes_ui')
        .select('code')
        .eq('code', code)
        .maybeSingle();
        
      if (validCodeError || !validCode) {
        throw new Error('Invalid beta code');
      }
      
      // Verify the beta code
      const { data: betaCode, error: codeError } = await supabase
        .from('beta_codes')
        .select('*')
        .eq('code', code)
        .maybeSingle();

      if (codeError || !betaCode) {
        throw new Error('Invalid beta code');
      }

      // Check if code is expired
      if (betaCode.expires_on && new Date(betaCode.expires_on) < new Date()) {
        throw new Error('Beta code has expired');
      }

      // Check if maximum uses reached
      if (betaCode.max_uses && betaCode.uses >= betaCode.max_uses) {
        throw new Error('Beta code has reached maximum usage');
      }

      // Check if user already has an active trial
      const { data: existingTrial, error: trialError } = await supabase
        .from('trial_subscriptions')
        .select('*')
        .eq('user_id', userId)
        .limit(1);

      if (trialError) {
        throw new Error('Error checking for existing trial');
      }

      if (existingTrial && existingTrial.length > 0) {
        const expirationDate = new Date(existingTrial[0].expires_on);
        if (expirationDate > new Date()) {
          throw new Error('You already have an active trial subscription');
        }
      }

      // Create the trial expiration date (30 days from now)
      const expiresOn = new Date();
      expiresOn.setDate(expiresOn.getDate() + 30);

      // Create or update the trial subscription (UPSERT to prevent duplicate-key errors)
      const { data: trial, error: insertError } = await supabase
        .from('trial_subscriptions')
        .upsert({
          user_id: userId,
          trial_code: code,
          start_date: new Date().toISOString(),
          expires_on: expiresOn.toISOString()
        }, { onConflict: 'user_id' })
        .select()
        .maybeSingle();

      if (insertError) {
        throw new Error('Failed to create trial subscription');
      }

      // Increment the uses count for the beta code
      await supabase
        .from('beta_codes')
        .update({ uses: betaCode.uses + 1 })
        .eq('code', code);

      return {
        success: true,
        trial,
        message: "Beta code activated successfully"
      };
    }
  } catch (error) {
    console.error('Error activating beta code:', error);
    throw error;
  }
};

export const createBetaCode = async (code: string, maxUses?: number, expiresOn?: Date) => {
  try {
    // Check if the current user has admin privileges
    // This is a very simplistic check - in a real app, you'd have proper admin authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('You must be logged in to create beta codes');
    }
    
    // Create the beta code
    const { data, error } = await supabase
      .from('beta_codes')
      .insert({
        code,
        max_uses: maxUses,
        expires_on: expiresOn?.toISOString(),
        uses: 0
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Also add it to the valid_beta_codes_ui table
    await supabase
      .from('valid_beta_codes_ui')
      .insert({ code })
      .select();

    return data;
  } catch (error) {
    console.error('Error creating beta code:', error);
    throw error;
  }
};