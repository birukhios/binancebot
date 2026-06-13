export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bot_advisor_calls: {
        Row: {
          created_at: string
          decision: Json
          id: string
          symbol: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decision: Json
          id?: string
          symbol: string
          user_id: string
        }
        Update: {
          created_at?: string
          decision?: Json
          id?: string
          symbol?: string
          user_id?: string
        }
        Relationships: []
      }
      bot_config: {
        Row: {
          advisor_enabled: boolean
          auto_select_enabled: boolean
          auto_select_max_symbols: number
          drawdown_pause_pct: number
          is_running: boolean
          max_total_notional_usdt: number
          news_currencies: string
          news_pause_enabled: boolean
          news_pause_window_min: number
          testnet: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          advisor_enabled?: boolean
          auto_select_enabled?: boolean
          auto_select_max_symbols?: number
          drawdown_pause_pct?: number
          is_running?: boolean
          max_total_notional_usdt?: number
          news_currencies?: string
          news_pause_enabled?: boolean
          news_pause_window_min?: number
          testnet?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          advisor_enabled?: boolean
          auto_select_enabled?: boolean
          auto_select_max_symbols?: number
          drawdown_pause_pct?: number
          is_running?: boolean
          max_total_notional_usdt?: number
          news_currencies?: string
          news_pause_enabled?: boolean
          news_pause_window_min?: number
          testnet?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      bot_logs: {
        Row: {
          context: Json | null
          created_at: string
          id: number
          level: string
          message: string
          symbol: string | null
          user_id: string
        }
        Insert: {
          context?: Json | null
          created_at?: string
          id?: number
          level?: string
          message: string
          symbol?: string | null
          user_id: string
        }
        Update: {
          context?: Json | null
          created_at?: string
          id?: number
          level?: string
          message?: string
          symbol?: string | null
          user_id?: string
        }
        Relationships: []
      }
      grid_orders: {
        Row: {
          binance_order_id: number | null
          client_order_id: string | null
          created_at: string
          id: string
          level_index: number | null
          price: number
          qty: number
          side: string
          status: string
          symbol: string
          updated_at: string
          user_id: string
        }
        Insert: {
          binance_order_id?: number | null
          client_order_id?: string | null
          created_at?: string
          id?: string
          level_index?: number | null
          price: number
          qty: number
          side: string
          status?: string
          symbol: string
          updated_at?: string
          user_id: string
        }
        Update: {
          binance_order_id?: number | null
          client_order_id?: string | null
          created_at?: string
          id?: string
          level_index?: number | null
          price?: number
          qty?: number
          side?: string
          status?: string
          symbol?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      symbol_config: {
        Row: {
          auto_managed: boolean
          auto_tune: boolean
          backtest_at: string | null
          backtest_fills: number | null
          backtest_max_drawdown: number | null
          backtest_pnl: number | null
          backtest_return_pct: number | null
          enabled: boolean
          extreme_loss_cooldown_min: number
          extreme_loss_threshold_usdt: number
          funding_filter_enabled: boolean
          funding_max_abs_bps: number
          grid_levels: number
          grid_spacing_pct: number
          last_advisor_at: string | null
          last_advisor_note: string | null
          last_learned_at: string | null
          learning_notes: string | null
          leverage: number
          lower_bound: number | null
          max_order_size_usdt: number
          max_position_age_minutes: number
          max_spacing_pct: number
          min_order_size_usdt: number
          min_spacing_pct: number
          order_size_usdt: number
          stop_loss_roi_pct: number
          symbol: string
          trend_ema_period: number
          trend_filter_enabled: boolean
          trend_interval: string
          updated_at: string
          upper_bound: number | null
          user_id: string
          z_entry_threshold: number
          z_filter_enabled: boolean
          z_interval: string
          z_lookback: number
        }
        Insert: {
          auto_managed?: boolean
          auto_tune?: boolean
          backtest_at?: string | null
          backtest_fills?: number | null
          backtest_max_drawdown?: number | null
          backtest_pnl?: number | null
          backtest_return_pct?: number | null
          enabled?: boolean
          extreme_loss_cooldown_min?: number
          extreme_loss_threshold_usdt?: number
          funding_filter_enabled?: boolean
          funding_max_abs_bps?: number
          grid_levels?: number
          grid_spacing_pct?: number
          last_advisor_at?: string | null
          last_advisor_note?: string | null
          last_learned_at?: string | null
          learning_notes?: string | null
          leverage?: number
          lower_bound?: number | null
          max_order_size_usdt?: number
          max_position_age_minutes?: number
          max_spacing_pct?: number
          min_order_size_usdt?: number
          min_spacing_pct?: number
          order_size_usdt?: number
          stop_loss_roi_pct?: number
          symbol: string
          trend_ema_period?: number
          trend_filter_enabled?: boolean
          trend_interval?: string
          updated_at?: string
          upper_bound?: number | null
          user_id: string
          z_entry_threshold?: number
          z_filter_enabled?: boolean
          z_interval?: string
          z_lookback?: number
        }
        Update: {
          auto_managed?: boolean
          auto_tune?: boolean
          backtest_at?: string | null
          backtest_fills?: number | null
          backtest_max_drawdown?: number | null
          backtest_pnl?: number | null
          backtest_return_pct?: number | null
          enabled?: boolean
          extreme_loss_cooldown_min?: number
          extreme_loss_threshold_usdt?: number
          funding_filter_enabled?: boolean
          funding_max_abs_bps?: number
          grid_levels?: number
          grid_spacing_pct?: number
          last_advisor_at?: string | null
          last_advisor_note?: string | null
          last_learned_at?: string | null
          learning_notes?: string | null
          leverage?: number
          lower_bound?: number | null
          max_order_size_usdt?: number
          max_position_age_minutes?: number
          max_spacing_pct?: number
          min_order_size_usdt?: number
          min_spacing_pct?: number
          order_size_usdt?: number
          stop_loss_roi_pct?: number
          symbol?: string
          trend_ema_period?: number
          trend_filter_enabled?: boolean
          trend_interval?: string
          updated_at?: string
          upper_bound?: number | null
          user_id?: string
          z_entry_threshold?: number
          z_filter_enabled?: boolean
          z_interval?: string
          z_lookback?: number
        }
        Relationships: []
      }
      symbol_locks: {
        Row: {
          locked_at: string
          symbol: string
          user_id: string
        }
        Insert: {
          locked_at?: string
          symbol: string
          user_id: string
        }
        Update: {
          locked_at?: string
          symbol?: string
          user_id?: string
        }
        Relationships: []
      }
      trades: {
        Row: {
          binance_order_id: number | null
          binance_trade_id: number | null
          commission: number
          filled_at: string
          id: string
          price: number
          qty: number
          realized_pnl: number
          side: string
          symbol: string
          user_id: string
        }
        Insert: {
          binance_order_id?: number | null
          binance_trade_id?: number | null
          commission?: number
          filled_at?: string
          id?: string
          price: number
          qty: number
          realized_pnl?: number
          side: string
          symbol: string
          user_id: string
        }
        Update: {
          binance_order_id?: number | null
          binance_trade_id?: number | null
          commission?: number
          filled_at?: string
          id?: string
          price?: number
          qty?: number
          realized_pnl?: number
          side?: string
          symbol?: string
          user_id?: string
        }
        Relationships: []
      }
      user_binance_creds: {
        Row: {
          api_key: string | null
          api_secret: string | null
          testnet_api_key: string | null
          testnet_api_secret: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key?: string | null
          api_secret?: string | null
          testnet_api_key?: string | null
          testnet_api_secret?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string | null
          api_secret?: string | null
          testnet_api_key?: string | null
          testnet_api_secret?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
