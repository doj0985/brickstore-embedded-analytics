// src/context/AuthContext.js
import React, { createContext, useState, useContext, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext();

// The app's JWT is sent in a custom header rather than Authorization: the
// Databricks Apps front-door proxy reserves Authorization for its own session
// auth and strips it before the request reaches the backend. Must match
// JWT_HEADER_NAME in backend/config.py.
const JWT_HEADER = 'X-JWT-Authorization';

const setAuthHeader = (token) => {
  if (token) {
    axios.defaults.headers.common[JWT_HEADER] = `Bearer ${token}`;
  } else {
    delete axios.defaults.headers.common[JWT_HEADER];
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    if (storedUser) {
      const parsed = JSON.parse(storedUser);
      setUser(parsed);
      setAuthHeader(parsed.access_token);
    }
    setIsLoading(false);

    // Global 401 handler: when the JWT expires (or anything else returns 401),
    // wipe local auth and bounce the user to the login screen.
    const interceptorId = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401 && window.location.pathname !== '/login') {
          localStorage.removeItem("user");
          setAuthHeader(null);
          setUser(null);
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptorId);
  }, []);

  const login = async (email, password) => {
    setIsLoading(true);
    try {
      const response = await axios.post('/api/login', { email, password });
      localStorage.setItem("user", JSON.stringify(response.data));
      setAuthHeader(response.data.access_token);
      setUser(response.data);
      return true;
    } catch (error) {
      console.error("Login failed:", error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("user");
    setAuthHeader(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
