const fs = require('fs');
const path = require('path');
const { query } = require('../server/models/db');

async function seedListings() {
  const listingsPath = path.join(__dirname, 'seed', 'listings.json');
  const listings = JSON.parse(fs.readFileSync(listingsPath, 'utf8'));

  console.log(`Seeding ${listings.length} listings...`);

  for (const listing of listings) {
    // Map sample data to DB schema (adjust fields as needed based on migrations)
    const dbRow = {
      listing_id: listing.id || `sample-${Date.now()}`,
      list_price: listing.price,
      address: listing.address,
      city: listing.city,
      state: listing.state,
      zip_code: listing.zip,
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      square_feet: listing.sqft,
      public_remarks: listing.description,
      mls_status: 'Active',
      list_office_name: 'Sample Office',
      list_agent_full_name: 'Sample Agent',
      // Add more fields from JSON as needed
    };

    await query(`
      INSERT INTO listings (listing_id, list_price, address, city, state, zip_code, bedrooms, bathrooms, square_feet, public_remarks, mls_status, list_office_name, list_agent_full_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (listing_id) DO NOTHING
    `, [
      dbRow.listing_id, dbRow.list_price, dbRow.address, dbRow.city, dbRow.state, dbRow.zip_code,
      dbRow.bedrooms, dbRow.bathrooms, dbRow.square_feet, dbRow.public_remarks, dbRow.mls_status,
      dbRow.list_office_name, dbRow.list_agent_full_name
    ]);
  }

  console.log('Seeding complete.');
}

if (require.main === module) {
  seedListings().then(() => process.exit(0)).catch(console.error);
}

module.exports = { seedListings };