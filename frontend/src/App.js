import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Home from './pages/Home';
import Login from './pages/Login';
import Dashboards from './pages/Dashboards';
import Genie from './pages/Genie';
import PrivateRoute from './components/PrivateRoute';

function App() {
  return (
    
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Login/>} />
          <Route path="/login" element={<Login/>} />
          <Route element={<PrivateRoute />}>
            <Route path="/home" element={<Home/>} />
            <Route path="/dashboards" element={<Dashboards/>} />
            <Route path="/genie" element={<Genie/>} />
            <Route path="/genie/c/:cid" element={<Genie/>} />
          </Route>
        </Routes>
      </Router>
    </AuthProvider> 
  );
}

export default App;