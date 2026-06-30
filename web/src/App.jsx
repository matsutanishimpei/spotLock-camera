import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import MobileVerifier from './components/MobileVerifier';
import './styles/light-theme.css';

export default function App() {
    return (
        <HashRouter>
            <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/mobile" element={<MobileVerifier />} />
            </Routes>
        </HashRouter>
    );
}
