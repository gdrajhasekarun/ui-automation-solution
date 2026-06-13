import { configureStore } from '@reduxjs/toolkit'
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux'
import appReducer from './appSlice'
import { api } from './api'
import { apiV2 } from '../v2/apiV2'
import { apiV3 } from '../v3/apiV3'

export const store = configureStore({
  reducer: {
    app: appReducer,
    [api.reducerPath]:   api.reducer,
    [apiV2.reducerPath]: apiV2.reducer,
    [apiV3.reducerPath]: apiV3.reducer,
  },
  middleware: (getDefault) =>
    getDefault().concat(api.middleware, apiV2.middleware, apiV3.middleware),
})

export type RootState   = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export const useAppDispatch: () => AppDispatch = useDispatch
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
