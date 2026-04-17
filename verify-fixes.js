
const API_KEY = "fc-e65f930ac573422d963a88d664fa9cbc";
const API_URL = "http://localhost:3002/v2/search";

async function testFixes() {
  const nonce = Date.now();
  console.log(`Testing AI Search Fixes (Nonce: ${nonce})...`);

  // 1. Test aiMode: "expand" and check for intent classification + aiMetadata fields
  console.log("\n1. Testing 'expand' mode and metadata...");
  const expandRes = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: `latest news about spaceX ${nonce}`,
      aiMode: "expand",
      includeExtra: ["aiMetadata"]
    })
  });
  const expandData = await expandRes.json();
  
  if (expandData.success && expandData.data.aiMetadata) {
    const meta = expandData.data.aiMetadata;
    console.log("AI Metadata received:", JSON.stringify(meta, null, 2));
    
    const requiredFields = ["intent", "expandedQueries", "totalCandidates", "processingTimeMs"];
    const missing = requiredFields.filter(f => meta[f] === undefined);
    
    if (missing.length === 0) {
      console.log("✅ All required aiMetadata fields present.");
    } else {
      console.log("❌ Missing aiMetadata fields:", missing);
    }
  } else {
    console.log("❌ Expand test failed or metadata missing:", JSON.stringify(expandData, null, 2));
  }

  // 2. Test relevanceScore normalization (0-1)
  console.log("\n2. Testing relevanceScore normalization...");
  const rerankRes = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: `machine learning tutorials ${nonce}`,
      aiMode: "rerank"
    })
  });
  const rerankData = await rerankRes.json();
  
  if (rerankData.success && rerankData.data.web && rerankData.data.web.length > 0) {
    const scores = rerankData.data.web.map(r => r.relevanceScore);
    console.log("Sample relevance scores:", scores.slice(0, 3));
    const allInRange = scores.every(s => s >= 0 && s <= 1);
    if (allInRange) {
      console.log("✅ All relevance scores are in 0-1 range.");
    } else {
      console.log("❌ Some relevance scores are OUTSIDE 0-1 range!");
    }
  } else {
    console.log("❌ Rerank test failed or no results. Response:", JSON.stringify(rerankData, null, 2));
  }

  // 3. Test includeExtra as array
  console.log("\n3. Testing includeExtra as array...");
  const extraRes = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: `Albert Einstein ${nonce}`,
      aiMode: "expand",
      includeExtra: ["aiMetadata", "knowledgeCards"]
    })
  });
  const extraData = await extraRes.json();
  
  if (extraData.success) {
    const keys = Object.keys(extraData.data);
    console.log("Response fields:", keys);
    if (keys.includes("aiMetadata") && !keys.includes("answers") && !keys.includes("suggestions")) {
      console.log("✅ includeExtra array filtering works (included 'aiMetadata', excluded others).");
    } else {
      console.log("❌ includeExtra array filtering FAILED or fields missing.");
    }
  } else {
    console.log("❌ Extra test failed. Response:", JSON.stringify(extraData, null, 2));
  }
}

testFixes().catch(console.error);
