import axios from 'axios';

// Base URL for our proxy
const API_BASE = '/api/timewave';

export const timewaveService = {
  /**
   * Fetch booked sales data (invoices)
   */
  async getSalesData() {
    try {
      // Fetching invoices as a proxy for sales data
      const response = await axios.get(`${API_BASE}/invoices`);
      return response.data;
    } catch (error) {
      console.error('Error fetching sales data from Timewave:', error);
      throw error;
    }
  },

  /**
   * Fetch customers list.
   */
  async getCustomers() {
    try {
      const response = await axios.get(`${API_BASE}/clients`);
      return response.data;
    } catch (error) {
      console.error('Error fetching customers from Timewave:', error);
      throw error;
    }
  },

  /**
   * Fetch schedule/jobs (missions) for the DispatchBoard.
   */
  async getSchedule(startDate: string, endDate: string) {
    try {
      const response = await axios.get(`${API_BASE}/missions`, {
        params: { 
          'filter[startdate]': startDate, 
          'filter[enddate]': endDate 
        }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching schedule from Timewave:', error);
      throw error;
    }
  },

  /**
   * Fetch employees (cleaners)
   */
  async getEmployees() {
    try {
      const response = await axios.get(`${API_BASE}/employees`);
      return response.data;
    } catch (error) {
      console.error('Error fetching employees from Timewave:', error);
      throw error;
    }
  },

  /**
   * Fetch issues (tickets)
   */
  async getIssues() {
    try {
      const response = await axios.get(`${API_BASE}/issues`);
      return response.data;
    } catch (error) {
      console.error('Error fetching issues from Timewave:', error);
      throw error;
    }
  }
};
