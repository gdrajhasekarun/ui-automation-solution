import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { store } from './store'
import AppV3 from './v3/AppV3'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <BrowserRouter>
      <Routes>
        <Route path="/*" element={<AppV3 />} />
      </Routes>
    </BrowserRouter>
  </Provider>
)
