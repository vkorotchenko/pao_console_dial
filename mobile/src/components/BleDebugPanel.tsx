import React, {useState} from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import {useAppStore} from '../store/useAppStore';

export interface DebugRow {
  name: string;
  char: string;
  access: string;
  value: string;
  unit: string;
}

interface Props {
  rows: DebugRow[];
  serviceNote?: string;
  title?: string;
}

export function BleDebugPanel({rows, serviceNote, title = 'BT Debug'}: Props) {
  const debugBt = useAppStore(state => state.debugBt);
  const [collapsed, setCollapsed] = useState(false);
  const [showUuidCol, setShowUuidCol] = useState(false);

  if (!debugBt) return null;

  return (
    <View style={styles.debugPanel}>
      <TouchableOpacity
        style={styles.debugHeader}
        onPress={() => setCollapsed(c => !c)}
        activeOpacity={0.7}>
        <Text style={styles.debugHeaderText}>
          {collapsed ? '\u25B6' : '\u25BC'} {title}
        </Text>
        <TouchableOpacity
          onPress={() => setShowUuidCol(v => !v)}
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Text style={styles.debugUuidToggle}>
            {showUuidCol ? 'Hide UUIDs' : 'Show UUIDs'}
          </Text>
        </TouchableOpacity>
      </TouchableOpacity>
      {!collapsed && (
        <View>
          <View style={styles.debugRow}>
            <Text style={[styles.debugCell, styles.debugCellName, styles.debugColHeader]}>Field</Text>
            <Text style={[styles.debugCell, styles.debugCellValue, styles.debugColHeader]}>Value</Text>
            {showUuidCol && (
              <>
                <Text style={[styles.debugCell, styles.debugCellChar, styles.debugColHeader]}>Char</Text>
                <Text style={[styles.debugCell, styles.debugCellAccess, styles.debugColHeader]}>Access</Text>
              </>
            )}
          </View>
          {rows.map((row, i) => (
            <View key={row.name} style={[styles.debugRow, i % 2 === 1 && styles.debugRowAlt]}>
              <Text style={[styles.debugCell, styles.debugCellName]}>{row.name}</Text>
              <Text style={[styles.debugCell, styles.debugCellValue]}>
                {row.value}{row.unit ? ` ${row.unit}` : ''}
              </Text>
              {showUuidCol && (
                <>
                  <Text style={[styles.debugCell, styles.debugCellChar]}>{row.char}</Text>
                  <Text style={[styles.debugCell, styles.debugCellAccess]}>{row.access}</Text>
                </>
              )}
            </View>
          ))}
          {serviceNote && showUuidCol && (
            <Text style={styles.debugServiceNote}>{serviceNote}</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  debugPanel: {
    marginTop: 16,
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    overflow: 'hidden',
  },
  debugHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#111',
  },
  debugHeaderText: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  debugUuidToggle: {
    color: '#4a9eff',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  debugRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  debugRowAlt: {
    backgroundColor: '#0f0f0f',
  },
  debugCell: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#ccc',
  },
  debugColHeader: {
    color: '#666',
    fontWeight: '700',
  },
  debugCellName: {
    flex: 3,
    color: '#7ec8e3',
  },
  debugCellValue: {
    flex: 2,
    color: '#fff',
  },
  debugCellChar: {
    flex: 2,
    color: '#888',
  },
  debugCellAccess: {
    flex: 1,
    color: '#888',
  },
  debugServiceNote: {
    padding: 8,
    fontSize: 9,
    fontFamily: 'monospace',
    color: '#444',
  },
});
