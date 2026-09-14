'use client';
import {
  Document,
  Page,
  Text,
  View,
  Link,
  pdf,
  StyleSheet,
} from '@react-pdf/renderer';
import type { Project } from '@/lib/project';
import { callSheetData, type ShootDay, type CallSheet } from '@/lib/production';
import { mapProvider, validCoordinates } from '@/lib/map-service';
const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: 'Helvetica', fontSize: 10, lineHeight: 1.5 },
  title: { fontSize: 24, marginBottom: 8 },
  section: { marginTop: 16 },
  heading: { fontSize: 13, marginBottom: 6, fontFamily: 'Helvetica-Bold' },
  footer: { position: 'absolute', bottom: 18, left: 36, fontSize: 8 },
});
export async function exportCallSheet(
  p: Project,
  day: ShootDay,
  sheet: CallSheet,
) {
  const data = callSheetData(p, day);
  const blob = await pdf(
    <Document title={`${p.title} - Call sheet ${day.number}`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{p.title}</Text>
        <Text>
          CALL SHEET · {day.date || 'Date TBC'} · SHOOT DAY {day.number}
        </Text>
        <Text>
          GENERAL CALL {day.generalCallTime} · ESTIMATED WRAP{' '}
          {day.estimatedWrapTime}
        </Text>
        <View style={styles.section}>
          <Text style={styles.heading}>LOCATIONS</Text>
          {data.locations.map((l) => (
            <View key={l.id} wrap={false}>
              <Text>
                {l.name} · {l.address}
              </Text>
              <Text>
                {l.contactName} · {l.contactPhone}
              </Text>
              {validCoordinates(l.lat, l.lng) && (
                <Link
                  src={mapProvider.directionsUrl({
                    lat: l.lat!,
                    lng: l.lng!,
                    address: l.address,
                  })}
                >
                  Map / directions
                </Link>
              )}
            </View>
          ))}
        </View>
        <View style={styles.section}>
          <Text style={styles.heading}>SCENES · PRODUCTION ORDER</Text>
          {data.scenes.map((s) => (
            <Text key={s.id}>
              {p.scenes.indexOf(s) + 1}. {s.heading} · {s.duration}s
            </Text>
          ))}
        </View>
        <View style={styles.section}>
          <Text style={styles.heading}>CAST</Text>
          {data.characters.map((c) => {
            const a = data.cast.find((a) => a.id === c.castMemberId);
            return (
              <Text key={c.id}>
                {a?.name ?? 'UNCAST'} · {c.name} · Call{' '}
                {a ? (sheet.castCallTimes[a.id] ?? day.generalCallTime) : 'TBC'}
              </Text>
            );
          })}
        </View>
        <View style={styles.section}>
          <Text style={styles.heading}>DEPARTMENTS / REQUIREMENTS</Text>
          {data.requirements
            .filter((i) => !['cast', 'locations'].includes(i.category))
            .map((i) => (
              <Text key={i.id}>
                {i.category.replace(/_/g, ' ')} ·{' '}
                {p.assets?.find((a) => a.id === i.linkedAssetId)?.name ??
                  i.name}
                {i.quantity ? ` × ${i.quantity}` : ''} · {i.notes}
              </Text>
            ))}
        </View>
        <View style={styles.section}>
          <Text style={styles.heading}>CONTACTS / NOTES</Text>
          <Text>{sheet.productionContact || 'Production contact TBC'}</Text>
          <Text>{day.notes}</Text>
          <Text>{sheet.notes}</Text>
        </View>
        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Draft-it PRO · ${pageNumber} / ${totalPages}`
          }
        />
      </Page>
    </Document>,
  ).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `call-sheet-${day.number}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
