// Login page functionality
async function authenticate() {
  const statusEl = document.getElementById("status");
  const button = document.querySelector('.auth-btn');
  
  if (!window.nostr) {
    statusEl.className = 'error';
    statusEl.innerText = "Nostr extension not detected! Please install a Nostr signer extension.";
    return;
  }

  try {
    button.disabled = true;
    statusEl.className = '';
    statusEl.innerText = "Initiating authentication...";

    // First fetch a session ID from the server
    const sessionResponse = await fetch("/login", {
      method: "GET"
    });

    if (!sessionResponse.ok) {
      throw new Error("Failed to create session");
    }

    // Get the session ID from the response
    const sessionId = await sessionResponse.text();
    statusEl.innerText = "Session created. Requesting signature...";
    
    // Get the public key from the Nostr extension
    const pubkey = await window.nostr.getPublicKey();
    
    // Create the event with the session ID as content
    const event = {
      kind: 27235, // NIP-98 style auth event
      created_at: Math.floor(Date.now() / 1000),
      tags: [["u", window.location.origin], ["method", "POST"]],
      content: sessionId,
      pubkey: pubkey
    };

    // Sign the event
    const signedEvent = await window.nostr.signEvent(event);
    statusEl.innerText = "Event signed. Verifying...";

    // Send the signed event to verify the session
    const response = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signedEvent)
    });

    if (response.ok) {
      statusEl.className = 'success';
      statusEl.innerText = "Authentication successful! Redirecting...";
      setTimeout(() => location.reload(), 1000);
    } else {
      console.log(await response.text());
      statusEl.className = 'error';
      statusEl.innerText = "Authentication failed. Please try again.";
      button.disabled = false;
    }
  } catch (e) {
    statusEl.className = 'error';
    statusEl.innerText = "Error: " + e.message;
    button.disabled = false;
  }
}

// Admin page functionality
async function logout() {
  try {
    const response = await fetch('/logout', {
      method: 'GET'
    });
    
    if (response.ok) {
      document.getElementById('status').innerText = 'Logging out...';
      setTimeout(() => window.location.href = '/', 1000);
    } else {
      document.getElementById('status').innerText = 'Logout failed: ' + await response.text();
    }
  } catch (e) {
    document.getElementById('status').innerText = 'Error during logout: ' + e.message;
  }
} 