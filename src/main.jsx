import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { AuthProvider } from './auth/AuthContext'
import { installUserStorageShim } from './auth/userStorage'

installUserStorageShim();

ReactDOM.createRoot(document.getElementById('root')).render(
    <AuthProvider>
        <App />
    </AuthProvider>
)
