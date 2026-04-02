import { getTimewaveCustomers } from './api/_lib/timewaveData.js';
try {
  console.log("Fetching...");
  await getTimewaveCustomers();
  console.log("Success");
} catch (err) {
  console.log(err.message, err.cause);
}
