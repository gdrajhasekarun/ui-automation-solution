import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { store } from './store'
import App from './App'
import AppV2 from './v2/AppV2'
import AppV3 from './v3/AppV3'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <BrowserRouter>
      <Routes>
        <Route path="/v3/*" element={<AppV3 />} />
        <Route path="/v2/*" element={<AppV2 />} />
        <Route path="/*"    element={<App />} />
      </Routes>
    </BrowserRouter>
  </Provider>
)
