-- ================================================================
-- Lebenswerk – Demo-Inhalte für den Benutzer "Andreas"
-- Ausführen in: Supabase Dashboard → SQL Editor → New query → Run
-- ================================================================
--
-- Legt für JEDE der 8 Produktkategorien an:
--   - 1 Buch-Subjekt (memorials-Zeile, owner_user = Andreas)
--   - 5 Beitragende (contributions), je 5 Frage/Antwort-Paare
--     (jede Antwort = 3 Sätze), im messages-jsonb-Format
--     [{"role":"assistant","content":Frage},{"role":"user","content":Antwort}, …]
--
-- Idempotent (on conflict do nothing). Benötigt einen vorhandenen
-- Benutzer "Andreas" in app_users.
-- ================================================================

begin;

-- Abbruch, falls der Benutzer fehlt (sonst würde owner_user still NULL).
do $$
begin
  if not exists (select 1 from app_users where lower(username) = lower('Andreas')) then
    raise exception 'Benutzer "Andreas" existiert nicht in app_users – bitte zuerst anlegen.';
  end if;
end $$;

-- ================================================================
-- 1) GEDENKBUCH (memorial) – Friedrich „Fritz" Wagner (1942–2024)
-- ================================================================
insert into memorials (id, name, birth_year, death_year, organizer, gender, product_category, owner_user, languages, intake)
values ('ANDMEM', 'Friedrich „Fritz" Wagner', '1942', '2024', 'Andreas', 'männlich', 'memorial',
        (select id from app_users where lower(username) = lower('Andreas')), '{de}', '{}'::jsonb)
on conflict (id) do nothing;

insert into contributions (id, memorial_id, contributor_name, relationship, contributor_gender, contributor_address, messages) values
('MEM001', 'ANDMEM', 'Andreas Wagner', 'Sohn', 'männlich', 'Du', '[
{"role":"assistant","content":"Erzähl mir von einer Erinnerung an deinen Vater, die dir besonders kostbar ist."},
{"role":"user","content":"Jeden Sonntag stand mein Vater früh auf und backte für uns frische Brötchen. Der Geruch zog durch das ganze Haus und weckte uns sanfter als jeder Wecker. Diese ruhigen Morgen am Küchentisch sind für mich der Inbegriff von Geborgenheit."},
{"role":"assistant","content":"Was hat dein Vater dir fürs Leben mitgegeben?"},
{"role":"user","content":"Er hat mir beigebracht, dass man sein Wort hält, egal wie unbequem es wird. Nie habe ich erlebt, dass er eine Zusage gebrochen hätte. Diese Verlässlichkeit versuche ich bis heute an meine eigenen Kinder weiterzugeben."},
{"role":"assistant","content":"Gab es ein Hobby, das ihn besonders ausmachte?"},
{"role":"user","content":"Mein Vater war mit Leib und Seele Imker und besaß acht Bienenvölker im Garten. Stundenlang konnte er von der Welt der Bienen erzählen, ohne sich je zu langweilen. Den ersten eigenen Honig schenkte er immer zuerst den Nachbarn."},
{"role":"assistant","content":"Wie würdest du seinen Humor beschreiben?"},
{"role":"user","content":"Er hatte einen trockenen, leisen Humor, der oft erst Sekunden später zündete. Bei Familienfeiern wartete er geduldig auf den richtigen Moment für eine kleine Pointe. Wenn dann alle lachten, lächelte er nur zufrieden in sich hinein."},
{"role":"assistant","content":"Was möchtest du ihm heute gerne noch sagen?"},
{"role":"user","content":"Ich möchte ihm danken, dass er mir immer den Rücken freigehalten hat. Erst heute verstehe ich, wie viel er still für uns getragen hat. Ich hoffe, dass er stolz auf den Weg ist, den ich gegangen bin."}
]'::jsonb),
('MEM002', 'ANDMEM', 'Helga Wagner', 'Ehefrau', 'weiblich', 'Du', '[
{"role":"assistant","content":"Wie habt ihr beide euch kennengelernt?"},
{"role":"user","content":"Wir lernten uns 1965 auf einem Tanzabend im Gemeindesaal kennen. Fritz traute sich erst nach dem dritten Lied, mich aufzufordern, und trat mir prompt auf den Fuß. Wir mussten beide so lachen, dass wir den Rest des Abends zusammenblieben."},
{"role":"assistant","content":"Was hat eure Ehe über die Jahre getragen?"},
{"role":"user","content":"Wir haben gelernt, abends nie im Streit einzuschlafen, egal wie schwer der Tag war. Fritz konnte unglaublich gut zuhören, ohne gleich alles lösen zu wollen. Diese Geduld hat uns durch fast sechzig gemeinsame Jahre getragen."},
{"role":"assistant","content":"Gibt es einen gemeinsamen Ort, der euch viel bedeutet hat?"},
{"role":"user","content":"Jeden Sommer fuhren wir an denselben kleinen See in den Bergen. Dort hatten wir eine Bank, auf der wir stundenlang einfach nur das Wasser betrachteten. Noch heute spüre ich dort seine Nähe ganz besonders."},
{"role":"assistant","content":"Welche kleine Eigenheit von ihm vermisst du am meisten?"},
{"role":"user","content":"Er summte beim Kochen immer dieselben alten Schlager, oft völlig falsch. Anfangs hat es mich geneckt, später wurde es zur liebsten Melodie meines Tages. Heute ist die Küche viel zu still geworden."},
{"role":"assistant","content":"Was wünschst du dir, dass die Menschen über ihn in Erinnerung behalten?"},
{"role":"user","content":"Ich möchte, dass die Menschen sich an seine Wärme erinnern. Er hatte für jeden ein offenes Ohr, ganz gleich, wie es ihm selbst gerade ging. Diese Großherzigkeit war sein größtes Geschenk an die Welt."}
]'::jsonb),
('MEM003', 'ANDMEM', 'Peter Brandt', 'langjähriger Freund', 'männlich', 'Du', '[
{"role":"assistant","content":"Wie ist eure Freundschaft entstanden?"},
{"role":"user","content":"Fritz und ich haben uns als junge Männer in derselben Werkstatt kennengelernt. Schon in der ersten Mittagspause merkten wir, dass wir denselben verrückten Humor teilten. Aus Kollegen wurden innerhalb weniger Wochen die besten Freunde."},
{"role":"assistant","content":"Gibt es ein gemeinsames Abenteuer, an das du oft denkst?"},
{"role":"user","content":"Einmal sind wir mit einem klapprigen alten Auto bis ans Meer gefahren, ohne Karte und ohne Plan. Natürlich blieben wir auf halbem Weg liegen und mussten im Heu einer Scheune übernachten. Bis heute war das eine unserer schönsten Reisen."},
{"role":"assistant","content":"Worauf konntest du dich bei ihm immer verlassen?"},
{"role":"user","content":"Wenn ich Fritz anrief, war er da, egal zu welcher Uhrzeit. Als bei mir einmal das Dach undicht wurde, stand er morgens um sechs mit Werkzeug vor der Tür. Ein verlässlicherer Freund ist mir nie begegnet."},
{"role":"assistant","content":"Was habt ihr beide am liebsten zusammen gemacht?"},
{"role":"user","content":"Wir saßen gern stundenlang über einem Schachbrett im Garten. Fritz spielte bedächtig und ließ mich oft glauben, ich würde gewinnen. Im letzten Moment drehte er die Partie dann doch mit einem listigen Zug."},
{"role":"assistant","content":"Was würdest du jungen Menschen über ihn erzählen?"},
{"role":"user","content":"Ich würde ihnen sagen, dass wahre Größe in der Bescheidenheit liegt. Fritz hat nie viel Aufhebens um sich gemacht und doch unzählige Menschen geprägt. Sein ruhiges Vorbild war mehr wert als tausend große Worte."}
]'::jsonb),
('MEM004', 'ANDMEM', 'Sandra Keller', 'Nachbarin', 'weiblich', 'Sie', '[
{"role":"assistant","content":"Wie haben Sie Herrn Wagner als Nachbarn erlebt?"},
{"role":"user","content":"Als wir vor zwölf Jahren einzogen, stand Herr Wagner schon am ersten Tag mit einem selbstgebackenen Kuchen vor der Tür. Er zeigte uns die ganze Nachbarschaft und stellte uns allen vor. Von Anfang an fühlten wir uns dadurch willkommen."},
{"role":"assistant","content":"Gab es eine Situation, in der er Ihnen besonders geholfen hat?"},
{"role":"user","content":"In einem strengen Winter fiel bei uns die Heizung aus, während mein Mann verreist war. Herr Wagner kam sofort herüber und reparierte sie mit ruhiger Hand. Danach wollte er nicht einmal einen Kaffee als Dank annehmen."},
{"role":"assistant","content":"Was machte ihn in der Nachbarschaft so beliebt?"},
{"role":"user","content":"Er kannte wirklich jeden in der Straße mit Namen, vom ältesten Bewohner bis zum jüngsten Kind. Niemals ging er vorbei, ohne ein paar freundliche Worte zu wechseln. Dadurch fühlte sich unsere Straße immer wie eine kleine Familie an."},
{"role":"assistant","content":"Woran denken Sie, wenn Sie an seinen Garten denken?"},
{"role":"user","content":"Sein Garten war das Schmuckstück der ganzen Straße und blühte von Frühling bis Herbst. Im Sommer brachte er uns oft einen Korb voll Tomaten und Kräuter vorbei. Die Bienen summten dort so laut, dass man es bis auf den Gehweg hörte."},
{"role":"assistant","content":"Was bleibt Ihnen von ihm in Erinnerung?"},
{"role":"user","content":"Mir bleibt sein freundliches Winken jeden Morgen am Gartenzaun. Es war eine kleine Geste, die dem Tag sofort etwas Gutes gab. Diese stille Herzlichkeit werde ich sehr vermissen."}
]'::jsonb),
('MEM005', 'ANDMEM', 'Michael Wagner', 'Enkel', 'männlich', 'Du', '[
{"role":"assistant","content":"Was hast du als Kind am liebsten mit deinem Opa gemacht?"},
{"role":"user","content":"Mein Opa nahm mich oft mit zu seinen Bienenstöcken und erklärte mir alles ganz genau. Ich durfte sogar einmal vorsichtig eine Wabe in der Hand halten. Dieser Moment fühlte sich an wie ein großes Geheimnis, das nur uns beiden gehörte."},
{"role":"assistant","content":"Gibt es einen Satz von ihm, den du nie vergessen wirst?"},
{"role":"user","content":"Er sagte immer: „Mach langsam, dann kommst du schneller an.“ Als Kind verstand ich das überhaupt nicht. Heute denke ich fast jeden Tag an diesen Satz und merke, wie recht er hatte."},
{"role":"assistant","content":"Wie war Opa, wenn ihr zusammen etwas gebaut habt?"},
{"role":"user","content":"Wir bauten einmal ein Vogelhaus zusammen, und er ließ mich jeden Nagel selbst einschlagen. Auch als ich daneben schlug, blieb er völlig ruhig. Am Ende waren wir beide unglaublich stolz auf unser schiefes kleines Werk."},
{"role":"assistant","content":"Was hat dich an deinem Opa am meisten beeindruckt?"},
{"role":"user","content":"Mich hat beeindruckt, wie viel er über die Natur wusste, ganz ohne Bücher. Er konnte am Himmel das Wetter für den nächsten Tag ablesen. Für mich war er wie ein weiser Zauberer aus einer anderen Zeit."},
{"role":"assistant","content":"Was möchtest du von ihm in dein eigenes Leben mitnehmen?"},
{"role":"user","content":"Ich möchte seine Geduld mit Menschen und mit der Natur mitnehmen. Er hat mir gezeigt, dass die schönsten Dinge Zeit brauchen. Wenn ich später einmal selbst Kinder habe, will ich ihnen genau das weitergeben."}
]'::jsonb)
on conflict (id) do nothing;

-- ================================================================
-- 2) GEBURTSTAGSBUCH (birthday) – Margarete „Grete" Hoffmann, 70.
-- ================================================================
insert into memorials (id, name, organizer, gender, product_category, owner_user, languages, intake)
values ('ANDGEB', 'Margarete „Grete" Hoffmann', 'Andreas', 'weiblich', 'birthday',
        (select id from app_users where lower(username) = lower('Andreas')), '{de}', '{"occasion":"70. Geburtstag"}'::jsonb)
on conflict (id) do nothing;

insert into contributions (id, memorial_id, contributor_name, relationship, contributor_gender, contributor_address, messages) values
('GEB001', 'ANDGEB', 'Andreas Hoffmann', 'Sohn', 'männlich', 'Du', '[
{"role":"assistant","content":"Was macht deine Mutter als Mensch besonders?"},
{"role":"user","content":"Meine Mutter ist der ruhende Pol unserer ganzen Familie. Egal wie groß das Chaos ist, sie behält die Übersicht und ein Lächeln. Bei ihr fühlt sich jedes Problem gleich nur noch halb so schlimm an."},
{"role":"assistant","content":"Erinnerst du dich an einen besonders schönen Geburtstag mit ihr?"},
{"role":"user","content":"An ihrem sechzigsten haben wir sie mit einer Überraschungsfeier im Garten empfangen. Als sie um die Ecke kam und alle riefen, stand sie erst sprachlos da. Dann liefen ihr vor Freude die Tränen über das Gesicht."},
{"role":"assistant","content":"Welche ihrer Eigenschaften bewunderst du?"},
{"role":"user","content":"Ich bewundere, wie meine Mutter nie aufhört, Neues zu lernen. Mit fünfundsechzig hat sie noch angefangen, Italienisch zu lernen. Ihre Neugier auf das Leben steckt einfach jeden um sie herum an."},
{"role":"assistant","content":"Gibt es eine Marotte, die typisch für sie ist?"},
{"role":"user","content":"Sie hat in jeder Handtasche mindestens drei Notfall-Bonbons dabei. Egal wen sie trifft, jeder bekommt sofort eines angeboten. Diese kleine Geste ist so typisch für ihre Fürsorge."},
{"role":"assistant","content":"Was wünschst du ihr zum Geburtstag?"},
{"role":"user","content":"Ich wünsche ihr Gesundheit und noch viele neugierige Jahre. Sie soll endlich auch einmal an sich selbst denken und das Leben genießen. Vor allem aber wünsche ich mir, dass sie noch lange bei uns ist."}
]'::jsonb),
('GEB002', 'ANDGEB', 'Brigitte Lang', 'beste Freundin', 'weiblich', 'Du', '[
{"role":"assistant","content":"Wie lange kennt ihr euch schon?"},
{"role":"user","content":"Grete und ich kennen uns seit der ersten Klasse, also seit über sechzig Jahren. Wir saßen damals nebeneinander und teilten uns ein Pausenbrot. Seitdem hat uns nichts mehr trennen können."},
{"role":"assistant","content":"Was schätzt du an eurer Freundschaft am meisten?"},
{"role":"user","content":"Wir können uns monatelang nicht sehen und doch sofort weiterreden, als wäre keine Zeit vergangen. Auf Grete kann ich mich blind verlassen. Sie war bei jedem wichtigen Moment meines Lebens an meiner Seite."},
{"role":"assistant","content":"Gibt es eine lustige Geschichte, die ihr beide erlebt habt?"},
{"role":"user","content":"Einmal wollten wir gemeinsam einen Kuchen backen und verwechselten Salz mit Zucker. Das Ergebnis war so furchtbar, dass wir es heimlich in den Garten warfen. Wir lachen heute noch über die Mienen unserer Männer beim ersten Bissen."},
{"role":"assistant","content":"Was macht ihr am liebsten zusammen?"},
{"role":"user","content":"Wir gehen seit Jahrzehnten jeden Mittwoch zusammen schwimmen. Danach sitzen wir immer beim selben Café und tauschen alle Neuigkeiten aus. Diese Stunden sind für mich heilig geworden."},
{"role":"assistant","content":"Was möchtest du ihr zum Siebzigsten sagen?"},
{"role":"user","content":"Ich möchte ihr sagen, dass sie das größte Glück meines Lebens ist. Eine treuere Freundin könnte ich mir nicht vorstellen. Auf die nächsten siebzig Jahre, meine Liebe!"}
]'::jsonb),
('GEB003', 'ANDGEB', 'Thomas Hoffmann', 'Ehemann', 'männlich', 'Du', '[
{"role":"assistant","content":"Was hat dich damals an Grete bezaubert?"},
{"role":"user","content":"Es war ihr Lachen, das mich auf dem Sommerfest sofort gefangen nahm. Sie lachte so frei und herzlich, dass der ganze Raum heller wurde. Bis heute geht mir bei diesem Lachen das Herz auf."},
{"role":"assistant","content":"Was macht euer gemeinsames Leben aus?"},
{"role":"user","content":"Wir haben gelernt, auch im Alltäglichen das Schöne zu sehen. Selbst beim Abwasch finden wir noch Gründe zum Lachen. Diese Leichtigkeit hat unser Leben reich gemacht."},
{"role":"assistant","content":"Worin ist sie dir ein Vorbild?"},
{"role":"user","content":"Grete gibt niemals jemanden auf, auch sich selbst nicht. In schweren Zeiten war sie immer die, die nach vorne schaute. Ihre Zuversicht hat unsere Familie schon oft getragen."},
{"role":"assistant","content":"Gibt es einen besonderen gemeinsamen Traum, den ihr euch erfüllt habt?"},
{"role":"user","content":"Wir haben uns vor zehn Jahren den Traum einer Reise nach Italien erfüllt. Grete stand zum ersten Mal vor dem Meer und war still vor Glück. Diesen Moment werde ich nie vergessen."},
{"role":"assistant","content":"Was wünschst du dir für eure gemeinsame Zukunft?"},
{"role":"user","content":"Ich wünsche mir noch viele Jahre an ihrer Seite. Wir haben noch so viele Pläne und so viel zu lachen. Solange wir zusammen sind, fürchte ich nichts."}
]'::jsonb),
('GEB004', 'ANDGEB', 'Lena Hoffmann', 'Enkelin', 'weiblich', 'Du', '[
{"role":"assistant","content":"Was machst du am liebsten mit deiner Oma?"},
{"role":"user","content":"Meine Oma und ich backen am liebsten zusammen Plätzchen. Sie lässt mich den Teig naschen, auch wenn Mama das verbietet. Unsere Küche sieht danach immer aus wie ein Schlachtfeld, aber wir haben so viel Spaß."},
{"role":"assistant","content":"Was kannst du von deiner Oma lernen?"},
{"role":"user","content":"Meine Oma bleibt immer ruhig, auch wenn etwas schiefgeht. Wenn ich aufgeregt bin, nimmt sie meine Hand und alles wird besser. Ich wünschte, ich könnte einmal so gelassen sein wie sie."},
{"role":"assistant","content":"Gibt es etwas Lustiges, das nur ihr beide macht?"},
{"role":"user","content":"Oma und ich haben einen geheimen Handschlag, den nur wir kennen. Wenn wir uns sehen, machen wir ihn ganz schnell und kichern dabei. Niemand sonst in der Familie darf ihn lernen."},
{"role":"assistant","content":"Was magst du an ihren Geschichten?"},
{"role":"user","content":"Oma erzählt die spannendsten Geschichten von früher, als sie ein Mädchen war. Manche sind so unglaublich, dass ich nicht weiß, ob sie wahr sind. Aber genau das macht sie so wunderbar."},
{"role":"assistant","content":"Was wünschst du deiner Oma?"},
{"role":"user","content":"Ich wünsche meiner Oma, dass sie immer so fröhlich bleibt. Sie soll wissen, dass sie die beste Oma der Welt ist. Und ich hoffe, wir backen noch ganz viele Plätzchen zusammen."}
]'::jsonb),
('GEB005', 'ANDGEB', 'Renate Sommer', 'ehemalige Kollegin', 'weiblich', 'Sie', '[
{"role":"assistant","content":"Wie haben Sie Frau Hoffmann im Berufsleben erlebt?"},
{"role":"user","content":"Frau Hoffmann war über zwanzig Jahre die gute Seele unseres Büros. Sie hatte für jeden ein offenes Ohr, auch wenn der eigene Schreibtisch voll war. Ohne sie wäre der Laden manches Mal stehengeblieben."},
{"role":"assistant","content":"Gab es eine Situation, die ihren Charakter zeigt?"},
{"role":"user","content":"Als eine junge Kollegin einen großen Fehler machte, nahm Grete sie sofort in Schutz. Statt zu schimpfen, setzte sie sich hin und half ihr, alles zu reparieren. So etwas vergisst man im Berufsleben nicht."},
{"role":"assistant","content":"Was machte die Zusammenarbeit mit ihr besonders?"},
{"role":"user","content":"Sie brachte jeden Morgen gute Laune mit ins Büro. Selbst an grauen Montagen schaffte sie es, uns zum Lachen zu bringen. Ihre Herzlichkeit war ansteckender als jeder Kaffee."},
{"role":"assistant","content":"Woran denken Sie gern zurück?"},
{"role":"user","content":"Ich denke gern an unsere gemeinsamen Mittagspausen im Park zurück. Dort schmiedeten wir Pläne und vertrauten uns kleine Sorgen an. Aus einer Kollegin wurde so über die Jahre eine echte Freundin."},
{"role":"assistant","content":"Was möchten Sie ihr zum Geburtstag wünschen?"},
{"role":"user","content":"Ich wünsche ihr von Herzen einen wunderbaren Ehrentag. Sie hat so vielen Menschen Gutes getan und das soll nun zu ihr zurückkehren. Bleiben Sie, wie Sie sind, liebe Grete."}
]'::jsonb)
on conflict (id) do nothing;

-- ================================================================
-- 3) HOCHZEITSJUBILÄUM (anniversary) – Anna & Thomas Müller, Goldene Hochzeit
-- ================================================================
insert into memorials (id, name, organizer, product_category, owner_user, languages, intake)
values ('ANDHOC', 'Anna & Thomas Müller', 'Andreas', 'anniversary',
        (select id from app_users where lower(username) = lower('Andreas')), '{de}', '{"anniversaryType":"Goldene Hochzeit (50 Jahre)"}'::jsonb)
on conflict (id) do nothing;

insert into contributions (id, memorial_id, contributor_name, relationship, contributor_gender, contributor_address, messages) values
('HOC001', 'ANDHOC', 'Andreas Müller', 'Sohn', 'männlich', 'Du', '[
{"role":"assistant","content":"Wie würdest du die Ehe deiner Eltern in einem Bild beschreiben?"},
{"role":"user","content":"Die Ehe meiner Eltern ist wie ein alter, kräftiger Baum. Stürme haben an ihm gerüttelt, doch die Wurzeln sind nur tiefer geworden. Unter seinem Schatten haben wir Kinder uns immer geborgen gefühlt."},
{"role":"assistant","content":"Was haben dir deine Eltern als Paar vorgelebt?"},
{"role":"user","content":"Sie haben mir gezeigt, dass Liebe vor allem tägliche Arbeit ist. Jeden Morgen kocht mein Vater meiner Mutter einen Kaffee ans Bett, seit fünfzig Jahren. Diese kleinen Gesten haben mir mehr über die Liebe beigebracht als jedes Buch."},
{"role":"assistant","content":"Gibt es einen Moment, der ihre Verbundenheit besonders zeigt?"},
{"role":"user","content":"Als meine Mutter schwer krank im Krankenhaus lag, wich mein Vater nicht von ihrer Seite. Nacht für Nacht schlief er auf dem unbequemen Besucherstuhl. Erst als sie wieder lächelte, ging auch er nach Hause."},
{"role":"assistant","content":"Worüber lacht ihr in der Familie immer wieder?"},
{"role":"user","content":"Meine Eltern streiten sich seit Jahrzehnten liebevoll darüber, wer den Weg zum Restaurant besser kennt. Jedes Mal verfahren sie sich und schieben es dem anderen zu. Am Ende lachen sie und finden doch gemeinsam an."},
{"role":"assistant","content":"Was wünschst du deinen Eltern zur Goldenen Hochzeit?"},
{"role":"user","content":"Ich wünsche ihnen noch viele gemeinsame Jahre voller kleiner Rituale. Sie sollen stolz sein auf das, was sie zusammen aufgebaut haben. Und ich hoffe, ihre Liebe bleibt uns allen noch lange ein Vorbild."}
]'::jsonb),
('HOC002', 'ANDHOC', 'Claudia Weber', 'Tochter', 'weiblich', 'Du', '[
{"role":"assistant","content":"Was bedeutet dir das Zuhause deiner Eltern?"},
{"role":"user","content":"Das Haus meiner Eltern ist für mich der sicherste Ort der Welt. Egal was passiert, dort steht die Tür immer offen. Schon der Geruch im Flur gibt mir sofort das Gefühl, angekommen zu sein."},
{"role":"assistant","content":"Wie ergänzen sich deine Eltern als Paar?"},
{"role":"user","content":"Mein Vater ist der Träumer, meine Mutter die Macherin. Wenn er eine verrückte Idee hat, findet sie den Weg, sie umzusetzen. Zusammen sind sie deshalb ein unschlagbares Team."},
{"role":"assistant","content":"Erinnerst du dich an ein besonders schönes Familienfest?"},
{"role":"user","content":"Zu ihrer silbernen Hochzeit haben wir im Garten ein großes Fest gefeiert. Meine Eltern tanzten zu ihrem Hochzeitslied, als wären sie wieder jung. Alle Gäste hatten Tränen in den Augen vor Rührung."},
{"role":"assistant","content":"Welche Tradition der beiden magst du am liebsten?"},
{"role":"user","content":"Jeden Sonntag machen meine Eltern einen langen Spaziergang, Hand in Hand. Bei jedem Wetter ziehen sie ihre Runde durch den Wald. Diese Treue zu ihren kleinen Ritualen rührt mich jedes Mal."},
{"role":"assistant","content":"Was möchtest du den beiden zum Jubiläum sagen?"},
{"role":"user","content":"Ich möchte ihnen danken, dass sie uns ein so liebevolles Zuhause geschenkt haben. Ihre Ehe ist das schönste Geschenk, das sie uns Kindern machen konnten. Ich bin unendlich stolz, ihre Tochter zu sein."}
]'::jsonb),
('HOC003', 'ANDHOC', 'Wolfgang Reuter', 'Trauzeuge', 'männlich', 'Du', '[
{"role":"assistant","content":"Wie hast du die Hochzeit der beiden vor fünfzig Jahren erlebt?"},
{"role":"user","content":"Ich erinnere mich, als wäre es gestern gewesen, wie nervös Thomas vor dem Altar war. Seine Hände zitterten so sehr, dass er den Ring fast fallen ließ. Als Anna hereinkam, war auf einen Schlag alle Anspannung von ihm abgefallen."},
{"role":"assistant","content":"Wusstest du damals schon, dass es halten würde?"},
{"role":"user","content":"Ehrlich gesagt habe ich es im selben Moment gewusst, als ich die beiden ansah. So wie sie sich anschauten, gab es keinen Zweifel. Manche Paare passen einfach von Anfang an zusammen."},
{"role":"assistant","content":"Gibt es eine gemeinsame Erinnerung, die du besonders schätzt?"},
{"role":"user","content":"Wir vier waren über Jahre jeden Sommer gemeinsam zelten. Thomas und ich kümmerten uns ungeschickt ums Feuer, während Anna alles rettete. Diese Lagerfeuerabende gehören zu den schönsten meines Lebens."},
{"role":"assistant","content":"Was macht Thomas und Anna als Paar einzigartig?"},
{"role":"user","content":"Die beiden nehmen sich selbst nie zu ernst. Selbst nach fünfzig Jahren necken sie sich wie frisch Verliebte. Ihre Leichtigkeit hat schon vielen jungen Paaren Mut gemacht."},
{"role":"assistant","content":"Was wünschst du den beiden?"},
{"role":"user","content":"Ich wünsche meinen liebsten Freunden noch viele unbeschwerte Jahre. Mögen sie weiter so herzlich lachen wie an ihrem Hochzeitstag. Und ich hoffe, wir sitzen bald wieder gemeinsam am Lagerfeuer."}
]'::jsonb),
('HOC004', 'ANDHOC', 'Ingrid Müller', 'Schwägerin', 'weiblich', 'Du', '[
{"role":"assistant","content":"Wie hast du Anna damals in der Familie erlebt?"},
{"role":"user","content":"Als Anna in unsere Familie kam, war sie zunächst sehr schüchtern. Doch ihre Herzlichkeit eroberte schnell alle Herzen. Bald war sie nicht mehr die Angeheiratete, sondern eine echte Schwester für mich."},
{"role":"assistant","content":"Was schätzt du an Thomas als Bruder deines Mannes?"},
{"role":"user","content":"Thomas hat ein riesiges Herz und hilft jedem in der Familie ohne zu zögern. Wenn irgendwo eine Hand gebraucht wird, ist er sofort zur Stelle. Auf ihn konnten wir uns immer hundertprozentig verlassen."},
{"role":"assistant","content":"Wie erlebst du die beiden im Familienalltag?"},
{"role":"user","content":"Bei jedem Familienfest sind Anna und Thomas das Herzstück. Sie sorgen dafür, dass sich niemand allein fühlt. Ihr Haus war über die Jahre immer der Treffpunkt für uns alle."},
{"role":"assistant","content":"Gibt es eine schöne gemeinsame Erinnerung?"},
{"role":"user","content":"Wir haben einmal alle zusammen Annas runden Geburtstag in den Bergen gefeiert. Thomas hielt eine so liebevolle Rede, dass kein Auge trocken blieb. An diesem Wochenende sind wir als Familie noch enger zusammengewachsen."},
{"role":"assistant","content":"Was wünschst du dem Paar zur Goldenen Hochzeit?"},
{"role":"user","content":"Ich wünsche euch beiden Gesundheit und weiterhin so viel Liebe. Ihr seid das Herz unserer Familie und sollt es noch lange bleiben. Danke, dass ich ein Teil davon sein darf."}
]'::jsonb),
('HOC005', 'ANDHOC', 'Bernd Albers', 'Nachbar', 'männlich', 'Sie', '[
{"role":"assistant","content":"Wie erleben Sie die Müllers als Nachbarn?"},
{"role":"user","content":"Die Müllers sind die besten Nachbarn, die man sich wünschen kann. Seit zwanzig Jahren wohnen wir Tür an Tür und hatten nie ein böses Wort. Man spürt einfach, dass dort zwei warmherzige Menschen leben."},
{"role":"assistant","content":"Sieht man dem Paar seine lange gemeinsame Zeit an?"},
{"role":"user","content":"Man sieht es ihnen jeden Tag an, wenn sie zusammen im Garten arbeiten. Sie reichen sich wortlos das richtige Werkzeug, als wären sie ein Wesen. Diese Selbstverständlichkeit ist wunderschön zu beobachten."},
{"role":"assistant","content":"Gab es einen Moment nachbarschaftlicher Hilfe?"},
{"role":"user","content":"Als meine Frau im Krankenhaus lag, kochte Frau Müller jeden Tag für mich mit. Herr Müller half mir derweil im Garten, ohne dass ich fragen musste. Solche Nachbarn sind heute ein seltenes Geschenk."},
{"role":"assistant","content":"Was schätzen Sie an den beiden besonders?"},
{"role":"user","content":"Ich schätze ihre Verlässlichkeit und ihre gute Laune. Egal wann man sie trifft, sie haben ein freundliches Wort übrig. Ihr Lachen hört man oft über den Gartenzaun herüber."},
{"role":"assistant","content":"Was möchten Sie dem Paar zum Jubiläum wünschen?"},
{"role":"user","content":"Ich wünsche dem Paar von Herzen alles Gute zur Goldenen Hochzeit. Mögen sie noch viele Jahre so glücklich nebeneinander wohnen. Es ist ein Segen, solche Menschen als Nachbarn zu haben."}
]'::jsonb)
on conflict (id) do nothing;

-- ================================================================
-- 4) ABSCHIED & RUHESTAND (farewell) – Dr. Klaus Berger, Stadtwerke Musterstadt
-- ================================================================
insert into memorials (id, name, organizer, gender, product_category, owner_user, languages, intake)
values ('ANDABS', 'Dr. Klaus Berger', 'Andreas', 'männlich', 'farewell',
        (select id from app_users where lower(username) = lower('Andreas')), '{de}', '{"organization":"Stadtwerke Musterstadt"}'::jsonb)
on conflict (id) do nothing;

insert into contributions (id, memorial_id, contributor_name, relationship, contributor_gender, contributor_address, messages) values
('ABS001', 'ANDABS', 'Andreas Schmitt', 'langjähriger Kollege', 'männlich', 'Du', '[
{"role":"assistant","content":"Wie habt ihr beide zusammengearbeitet?"},
{"role":"user","content":"Klaus und ich haben fast dreißig Jahre Schreibtisch an Schreibtisch gesessen. In dieser Zeit haben wir unzählige Projekte gemeinsam gestemmt. Aus Kollegen sind über die Jahre echte Freunde geworden."},
{"role":"assistant","content":"Was zeichnet Klaus fachlich aus?"},
{"role":"user","content":"Klaus hatte für jedes technische Problem eine Lösung im Kopf. Wenn alle anderen verzweifelten, blieb er ruhig und fand einen Weg. Sein Wissen war für unser ganzes Team von unschätzbarem Wert."},
{"role":"assistant","content":"Gibt es eine Anekdote, die typisch für ihn ist?"},
{"role":"user","content":"Einmal fiel mitten in einer wichtigen Präsentation der Strom aus. Klaus hielt seinen Vortrag einfach bei Taschenlampenlicht weiter, als wäre nichts. Der Kunde war so beeindruckt, dass er sofort unterschrieb."},
{"role":"assistant","content":"Was wirst du an ihm am meisten vermissen?"},
{"role":"user","content":"Ich werde unsere morgendlichen Gespräche bei der ersten Tasse Kaffee vermissen. Da besprachen wir die Welt, bevor der Trubel losging. Ohne ihn wird das Büro deutlich stiller."},
{"role":"assistant","content":"Was wünschst du ihm für den Ruhestand?"},
{"role":"user","content":"Ich wünsche dir, lieber Klaus, endlich Zeit für deine geliebte Angelei. Genieße jeden Morgen, an dem du nicht den Wecker stellen musst. Und vergiss deine alten Kollegen nicht ganz."}
]'::jsonb),
('ABS002', 'ANDABS', 'Petra Hansen', 'Teamleiterin', 'weiblich', 'Sie', '[
{"role":"assistant","content":"Wie haben Sie Herrn Berger als Mitarbeiter erlebt?"},
{"role":"user","content":"Herr Berger war das verlässliche Rückgrat meines Teams. Auf seine Zusagen konnte ich mich zu hundert Prozent verlassen. In über zwanzig Jahren hat er mich nie enttäuscht."},
{"role":"assistant","content":"Was machte ihn zu einem besonderen Kollegen?"},
{"role":"user","content":"Er stellte stets das Team über das eigene Ego. Erfolge teilte er großzügig, Fehler nahm er auf seine Kappe. Diese Haltung hat unser ganzes Miteinander geprägt."},
{"role":"assistant","content":"Gab es ein Projekt, das ohne ihn nicht gelungen wäre?"},
{"role":"user","content":"Bei der großen Netzumstellung vor zehn Jahren stand das ganze Projekt auf der Kippe. Herr Berger arbeitete Nächte durch und brachte es allein durch seine Ruhe ins Ziel. Bis heute spricht man im Haus von dieser Leistung."},
{"role":"assistant","content":"Was werden Sie an ihm vermissen?"},
{"role":"user","content":"Ich werde seine besonnene Art in hektischen Momenten vermissen. Er konnte einen ganzen Raum mit einem einzigen ruhigen Satz beruhigen. Solche Menschen sind im Berufsleben selten geworden."},
{"role":"assistant","content":"Was wünschen Sie ihm zum Abschied?"},
{"role":"user","content":"Ich wünsche Herrn Berger einen Ruhestand voller Gesundheit und Freude. Er hat sich diese Zeit mehr als verdient. Die Tür bei uns steht für ihn immer offen."}
]'::jsonb),
('ABS003', 'ANDABS', 'Markus Klein', 'ehemaliger Auszubildender', 'männlich', 'Sie', '[
{"role":"assistant","content":"Welche Rolle hat Herr Berger in Ihrer Ausbildung gespielt?"},
{"role":"user","content":"Herr Berger war mein Ausbilder und prägte meinen ganzen Berufsweg. Er nahm sich Zeit für jede meiner Fragen, auch die dümmsten. Ohne ihn wäre ich heute nicht der Ingenieur, der ich bin."},
{"role":"assistant","content":"Was haben Sie von ihm gelernt?"},
{"role":"user","content":"Er brachte mir bei, niemals oberflächlich zu arbeiten. „Mach es richtig oder gar nicht“, sagte er immer wieder. Dieser Satz begleitet mich bis heute bei jeder Aufgabe."},
{"role":"assistant","content":"Gibt es einen Moment, der Ihnen in Erinnerung geblieben ist?"},
{"role":"user","content":"Als ich kurz vor meiner Prüfung völlig verzweifelt war, blieb er abends extra länger da. Geduldig ging er mit mir den gesamten Stoff durch. Am nächsten Tag bestand ich mit Bestnote, dank ihm."},
{"role":"assistant","content":"Wie würden Sie ihn als Mensch beschreiben?"},
{"role":"user","content":"Herr Berger war streng, aber immer gerecht. Hinter seiner ruhigen Fassade steckte ein unglaublich warmherziger Mensch. Er glaubte oft mehr an mich, als ich es selbst tat."},
{"role":"assistant","content":"Was möchten Sie ihm mit auf den Weg geben?"},
{"role":"user","content":"Ich möchte ihm von Herzen für sein Vertrauen danken. Er hat aus einem unsicheren jungen Mann einen selbstbewussten Fachmann gemacht. Ich wünsche ihm einen wunderbaren neuen Lebensabschnitt."}
]'::jsonb),
('ABS004', 'ANDABS', 'Birgit Möller', 'Kollegin aus dem Sekretariat', 'weiblich', 'Sie', '[
{"role":"assistant","content":"Wie war die Zusammenarbeit mit Herrn Berger im Alltag?"},
{"role":"user","content":"Herr Berger war einer der höflichsten Menschen im ganzen Haus. Nie vergaß er ein freundliches Wort oder ein Dankeschön. Mit ihm zusammenzuarbeiten war jeden Tag eine Freude."},
{"role":"assistant","content":"Was machte ihn im Büroalltag besonders?"},
{"role":"user","content":"Er dachte immer an die kleinen Dinge, die anderen entgingen. Zu jedem Geburtstag stand pünktlich eine Karte auf dem Schreibtisch. Diese Aufmerksamkeit machte ihn bei allen so beliebt."},
{"role":"assistant","content":"Gibt es eine Geschichte, die ihn gut beschreibt?"},
{"role":"user","content":"Als ich einmal an einem Feiertag arbeiten musste, brachte er mir unaufgefordert Kuchen mit. Er wollte nur, dass ich mich nicht allein fühle. So jemand war Herr Berger eben."},
{"role":"assistant","content":"Was werden Sie vermissen?"},
{"role":"user","content":"Ich werde sein freundliches „Guten Morgen“ am meisten vermissen. Es gab dem Tag sofort einen guten Anfang. Das Büro wird ohne ihn ein anderes sein."},
{"role":"assistant","content":"Was wünschen Sie ihm zum Ruhestand?"},
{"role":"user","content":"Ich wünsche Herrn Berger von Herzen alles Gute. Möge er die neue Freiheit in vollen Zügen genießen. Er soll wissen, dass er hier sehr fehlen wird."}
]'::jsonb),
('ABS005', 'ANDABS', 'Jürgen Wolf', 'Geschäftsführer', 'männlich', 'Sie', '[
{"role":"assistant","content":"Was hat Herr Berger für das Unternehmen bedeutet?"},
{"role":"user","content":"Herr Berger war über Jahrzehnte eine tragende Säule unseres Hauses. Sein Fachwissen und seine Loyalität waren durch nichts zu ersetzen. Ein solches Engagement findet man heute nur noch selten."},
{"role":"assistant","content":"Welche seiner Leistungen ist Ihnen besonders in Erinnerung?"},
{"role":"user","content":"Er hat unsere technische Abteilung über Jahre maßgeblich aufgebaut. Viele unserer heutigen Erfolge gehen auf sein Fundament zurück. Darauf darf er mit großem Stolz zurückblicken."},
{"role":"assistant","content":"Wie würden Sie seinen Charakter beschreiben?"},
{"role":"user","content":"Herr Berger war bescheiden, obwohl er allen Grund zum Stolz gehabt hätte. Er stellte stets die Sache über die eigene Person. Diese Integrität hat ihm im ganzen Haus höchsten Respekt eingebracht."},
{"role":"assistant","content":"Was zeichnet ihn als Führungskraft aus?"},
{"role":"user","content":"Er führte nicht durch Anweisungen, sondern durch sein Vorbild. Seine jungen Kollegen schauten zu ihm auf wie zu einem Mentor. Diese Art zu führen hat unser Haus nachhaltig geprägt."},
{"role":"assistant","content":"Was wünschen Sie ihm zum Abschied?"},
{"role":"user","content":"Im Namen des gesamten Unternehmens danke ich Herrn Berger für sein Lebenswerk. Wir wünschen ihm einen erfüllten und gesunden Ruhestand. Er wird für immer ein Teil unserer Geschichte bleiben."}
]'::jsonb)
on conflict (id) do nothing;

-- ================================================================
-- 5) DIENSTJUBILÄUM (service) – Sabine Vogt, 25 Jahre, Möbelhaus Lindner
-- ================================================================
insert into memorials (id, name, organizer, gender, product_category, owner_user, languages, intake)
values ('ANDDIE', 'Sabine Vogt', 'Andreas', 'weiblich', 'service',
        (select id from app_users where lower(username) = lower('Andreas')), '{de}', '{"organization":"Möbelhaus Lindner","years":"25 Jahre"}'::jsonb)
on conflict (id) do nothing;

insert into contributions (id, memorial_id, contributor_name, relationship, contributor_gender, contributor_address, messages) values
('DIE001', 'ANDDIE', 'Andreas Lindner', 'Inhaber', 'männlich', 'Sie', '[
{"role":"assistant","content":"Was bedeutet Frau Vogt für Ihr Haus?"},
{"role":"user","content":"Frau Vogt ist das Gesicht unseres Möbelhauses geworden. Viele Kunden kommen seit Jahren nur wegen ihr zu uns. Eine treuere Mitarbeiterin könnte ich mir nicht wünschen."},
{"role":"assistant","content":"Erinnern Sie sich an ihre Anfänge bei Ihnen?"},
{"role":"user","content":"Sie kam vor fünfundzwanzig Jahren als junge Verkäuferin zu uns. Schon am ersten Tag fiel mir ihr Talent im Umgang mit Menschen auf. Heute ist sie aus dem Haus nicht mehr wegzudenken."},
{"role":"assistant","content":"Was macht ihre Arbeit besonders?"},
{"role":"user","content":"Sie verkauft nicht einfach Möbel, sondern hilft Menschen, sich ein Zuhause zu schaffen. Für jeden Kunden nimmt sie sich so viel Zeit wie nötig. Diese Hingabe spürt jeder, der ihr begegnet."},
{"role":"assistant","content":"Gibt es einen Moment, der ihre Treue zeigt?"},
{"role":"user","content":"In einem schwierigen Geschäftsjahr verzichtete sie freiwillig auf Überstundenzuschläge, um zu helfen. Sie sagte, das Haus sei ihre zweite Familie. Diese Loyalität habe ich nie vergessen."},
{"role":"assistant","content":"Was wünschen Sie ihr zum Jubiläum?"},
{"role":"user","content":"Ich wünsche Frau Vogt von Herzen alles Gute zu diesem besonderen Tag. Ich hoffe, sie bleibt uns noch viele Jahre erhalten. Das ganze Haus ist unendlich dankbar für ihre Treue."}
]'::jsonb),
('DIE002', 'ANDDIE', 'Karin Bauer', 'Kollegin', 'weiblich', 'Du', '[
{"role":"assistant","content":"Wie lange arbeitet ihr schon zusammen?"},
{"role":"user","content":"Sabine und ich teilen uns seit zwanzig Jahren die Abteilung. In dieser Zeit haben wir alles miteinander durchgestanden. Eine bessere Kollegin gibt es einfach nicht."},
{"role":"assistant","content":"Was schätzt du an ihr am meisten?"},
{"role":"user","content":"Sabine lässt niemals jemanden im Stich, wenn es stressig wird. Wenn bei mir die Kunden Schlange stehen, ist sie sofort zur Stelle. Auf sie kann man sich blind verlassen."},
{"role":"assistant","content":"Gibt es eine lustige Erinnerung?"},
{"role":"user","content":"Einmal blieben wir beide nach Ladenschluss versehentlich im Lager eingeschlossen. Eine Stunde lang klopften wir lachend gegen die Tür. Heute ist das unsere Lieblingsgeschichte bei jeder Feier."},
{"role":"assistant","content":"Was macht die Arbeit mit ihr schön?"},
{"role":"user","content":"Mit Sabine vergeht selbst der längste Tag wie im Flug. Sie hat für jede Situation einen flotten Spruch parat. Ihre gute Laune trägt das ganze Team."},
{"role":"assistant","content":"Was möchtest du ihr zum Jubiläum sagen?"},
{"role":"user","content":"Liebe Sabine, danke für fünfundzwanzig Jahre Verlässlichkeit und Lachen. Du bist nicht nur eine Kollegin, sondern eine echte Freundin geworden. Auf viele weitere gemeinsame Jahre!"}
]'::jsonb),
('DIE003', 'ANDDIE', 'Tobias Frank', 'Teammitglied', 'männlich', 'Du', '[
{"role":"assistant","content":"Wie hat dich Sabine im Team aufgenommen?"},
{"role":"user","content":"Als ich neu anfing, nahm Sabine mich sofort unter ihre Fittiche. Sie zeigte mir geduldig jeden Handgriff im Haus. Dank ihr fühlte ich mich vom ersten Tag an willkommen."},
{"role":"assistant","content":"Was kannst du von ihr lernen?"},
{"role":"user","content":"Von Sabine lerne ich, wie man Kunden wirklich zuhört. Sie merkt sofort, was jemand braucht, noch bevor er es ausspricht. Diese Menschenkenntnis möchte ich mir abschauen."},
{"role":"assistant","content":"Gibt es eine Situation, die sie gut beschreibt?"},
{"role":"user","content":"Einmal kam kurz vor Ladenschluss eine verzweifelte Familie herein. Sabine blieb ohne zu murren eine Stunde länger, bis alles passte. Diese Familie kauft bis heute nur noch bei ihr."},
{"role":"assistant","content":"Wie ist Sabine als Mensch?"},
{"role":"user","content":"Sabine ist herzlich und immer ehrlich. Sie sagt einem klar die Meinung, aber nie verletzend. Genau das macht sie so glaubwürdig."},
{"role":"assistant","content":"Was wünschst du ihr?"},
{"role":"user","content":"Ich wünsche Sabine, dass sie noch lange so viel Freude an ihrer Arbeit hat. Sie soll wissen, wie viel sie uns Jüngeren bedeutet. Danke, dass du immer für uns da bist."}
]'::jsonb),
('DIE004', 'ANDDIE', 'Monika Schreiber', 'Vorgesetzte', 'weiblich', 'Sie', '[
{"role":"assistant","content":"Wie erleben Sie Frau Vogt als Mitarbeiterin?"},
{"role":"user","content":"Frau Vogt ist eine Mitarbeiterin, wie man sie sich nur wünschen kann. Sie denkt mit und übernimmt Verantwortung, ohne dass man sie darum bitten muss. Auf sie kann ich mich zu jeder Zeit verlassen."},
{"role":"assistant","content":"Was zeichnet ihre Arbeit aus?"},
{"role":"user","content":"Sie hat ein untrügliches Gespür für die Wünsche der Kunden. Selbst schwierige Situationen löst sie mit einem Lächeln. Damit ist sie ein Vorbild für das ganze Team."},
{"role":"assistant","content":"Gab es einen Moment, der Sie beeindruckt hat?"},
{"role":"user","content":"Als eine Kollegin länger ausfiel, übernahm Frau Vogt klaglos die doppelte Last. Sie hielt die Abteilung wochenlang allein zusammen. Eine solche Einsatzbereitschaft sieht man selten."},
{"role":"assistant","content":"Wie wirkt sie auf das Team?"},
{"role":"user","content":"Sie ist der ruhende Pol, an dem sich alle orientieren. In hektischen Phasen sorgt sie für Gelassenheit. Ihr Einfluss auf die Stimmung ist nicht zu überschätzen."},
{"role":"assistant","content":"Was wünschen Sie ihr zum Jubiläum?"},
{"role":"user","content":"Ich wünsche Frau Vogt zu ihrem Jubiläum von Herzen alles Gute. Ihre fünfundzwanzig Jahre Treue verdienen höchste Anerkennung. Ich freue mich auf viele weitere Jahre mit ihr."}
]'::jsonb),
('DIE005', 'ANDDIE', 'Daniel Roth', 'jüngerer Kollege', 'männlich', 'Du', '[
{"role":"assistant","content":"Was bedeutet dir Sabine als erfahrene Kollegin?"},
{"role":"user","content":"Für mich ist Sabine so etwas wie eine berufliche große Schwester. Sie hat mir alles beigebracht, was ich heute kann. Ohne ihre Geduld wäre mein Anfang viel schwerer gewesen."},
{"role":"assistant","content":"Gibt es etwas, das du besonders an ihr magst?"},
{"role":"user","content":"Ich mag, dass Sabine nie über jemanden hinweggeht. Sie hat für jeden im Team ein offenes Ohr. Bei ihr fühlt sich niemand zu unwichtig."},
{"role":"assistant","content":"Erinnerst du dich an eine schöne gemeinsame Situation?"},
{"role":"user","content":"An meinem ersten Weihnachtsgeschäft drohte ich völlig unterzugehen. Sabine blieb die ganze Zeit an meiner Seite und beruhigte mich. Am Ende waren wir beide stolz, dass wir es geschafft hatten."},
{"role":"assistant","content":"Wie würdest du sie in drei Worten beschreiben?"},
{"role":"user","content":"Herzlich, verlässlich und unglaublich tüchtig. Diese drei Worte treffen Sabine genau. Und doch beschreiben sie noch lange nicht alles."},
{"role":"assistant","content":"Was möchtest du ihr zum Jubiläum sagen?"},
{"role":"user","content":"Liebe Sabine, danke, dass du mich so geduldig begleitet hast. Du bist ein großes Vorbild für mich. Ich wünsche dir alles Glück der Welt zu deinem Jubiläum."}
]'::jsonb)
on conflict (id) do nothing;

-- ================================================================
-- 6) BETRIEBSJUBILÄUM (company) – Bäckerei Schmidt, 50-jähriges Bestehen
-- ================================================================
insert into memorials (id, name, organizer, product_category, owner_user, languages, intake)
values ('ANDFIR', 'Bäckerei Schmidt', 'Andreas', 'company',
        (select id from app_users where lower(username) = lower('Andreas')), '{de}', '{"anniversaryType":"50-jähriges Bestehen"}'::jsonb)
on conflict (id) do nothing;

insert into contributions (id, memorial_id, contributor_name, relationship, contributor_gender, contributor_address, messages) values
('FIR001', 'ANDFIR', 'Andreas Schmidt', 'Inhaber (zweite Generation)', 'männlich', 'Du', '[
{"role":"assistant","content":"Wie hat alles mit der Bäckerei angefangen?"},
{"role":"user","content":"Meine Eltern gründeten die Bäckerei 1976 mit kaum mehr als einem alten Ofen. Anfangs verkauften sie nur drei Sorten Brot aus einem winzigen Laden. Aus diesen bescheidenen Anfängen ist heute das Herz unseres Viertels geworden."},
{"role":"assistant","content":"Was macht eure Bäckerei besonders?"},
{"role":"user","content":"Bei uns wird bis heute alles von Hand und nach alten Familienrezepten gebacken. Wir verwenden nur Mehl aus der Region. Diese Qualität schmecken unsere Kunden bei jedem Bissen."},
{"role":"assistant","content":"Gibt es einen schweren Moment in der Geschichte?"},
{"role":"user","content":"In den Neunzigern brannte unsere Backstube über Nacht fast vollständig aus. Das halbe Viertel half uns beim Wiederaufbau, ohne einen Cent zu verlangen. In diesem Moment verstand ich, was unsere Bäckerei den Menschen bedeutet."},
{"role":"assistant","content":"Worauf bist du besonders stolz?"},
{"role":"user","content":"Ich bin stolz, dass wir nie unsere Seele an die Massenproduktion verkauft haben. Wir sind ein echter Familienbetrieb geblieben. Dass ich das Werk meiner Eltern weiterführen darf, erfüllt mich jeden Tag."},
{"role":"assistant","content":"Was wünschst du der Bäckerei für die Zukunft?"},
{"role":"user","content":"Ich wünsche mir, dass auch meine Kinder einmal mit Freude hier backen. Möge der Duft frischen Brotes noch viele Jahrzehnte durch unser Viertel ziehen. Und vor allem sollen uns unsere treuen Kunden erhalten bleiben."}
]'::jsonb),
('FIR002', 'ANDFIR', 'Helga Schmidt', 'Mitgründerin', 'weiblich', 'Du', '[
{"role":"assistant","content":"Wie war die Anfangszeit der Bäckerei?"},
{"role":"user","content":"Wir standen jeden Morgen um drei Uhr in der Backstube, mein Mann und ich. Geld war knapp, doch unsere Begeisterung war grenzenlos. Diese ersten Jahre waren hart, aber die glücklichsten meines Lebens."},
{"role":"assistant","content":"Welche Erinnerung ist dir besonders kostbar?"},
{"role":"user","content":"Ich erinnere mich an den Tag, als wir das erste Mal eine Schlange vor dem Laden hatten. Mein Mann und ich sahen uns an und wussten, dass wir es geschafft hatten. Vor Freude haben wir hinter der Theke geweint."},
{"role":"assistant","content":"Was war euch im Umgang mit den Kunden immer wichtig?"},
{"role":"user","content":"Wir wollten, dass jeder Kunde sich wie ein Gast in unserem Haus fühlt. Für ein freundliches Wort war immer Zeit, egal wie viel zu tun war. Viele unserer Kunden wurden über die Jahre zu echten Freunden."},
{"role":"assistant","content":"Worauf bist du heute am stolzesten?"},
{"role":"user","content":"Am stolzesten bin ich, dass unser Sohn den Betrieb mit so viel Herz weiterführt. Unser Lebenswerk ist in den besten Händen. Schöneres kann sich eine Mutter nicht wünschen."},
{"role":"assistant","content":"Was wünschst du der Bäckerei zum Jubiläum?"},
{"role":"user","content":"Ich wünsche unserer Bäckerei noch viele goldene Jahre. Möge sie immer ein Ort der Wärme und des guten Brotes bleiben. Fünfzig Jahre sind ein Geschenk, für das ich unendlich dankbar bin."}
]'::jsonb),
('FIR003', 'ANDFIR', 'Fatima Yilmaz', 'langjährige Mitarbeiterin', 'weiblich', 'Sie', '[
{"role":"assistant","content":"Wie lange arbeiten Sie schon in der Bäckerei?"},
{"role":"user","content":"Ich stehe seit dreißig Jahren hinter der Theke der Bäckerei Schmidt. Es war meine erste Stelle in Deutschland und ist mein zweites Zuhause geworden. Die Familie Schmidt hat mich von Anfang an aufgenommen wie eine der ihren."},
{"role":"assistant","content":"Was schätzen Sie an Ihrer Arbeit?"},
{"role":"user","content":"Ich liebe es, morgens die Stammkunden mit Namen zu begrüßen. Viele erzählen mir ihre kleinen Sorgen und Freuden. Diese Verbindung zu den Menschen macht meine Arbeit so wertvoll."},
{"role":"assistant","content":"Gibt es eine schöne Erinnerung?"},
{"role":"user","content":"Als mein Sohn geboren wurde, schenkte mir die Familie Schmidt einen ganzen Korb voll Backwaren. Sie waren die ersten Gratulanten vor der Tür. Solche Gesten vergisst man ein Leben lang nicht."},
{"role":"assistant","content":"Was macht die Bäckerei für Sie besonders?"},
{"role":"user","content":"Hier zählt der Mensch noch mehr als der Umsatz. Niemand wird hier behandelt wie eine Nummer. Diese Herzlichkeit spürt man in jeder Ecke des Ladens."},
{"role":"assistant","content":"Was wünschen Sie der Bäckerei?"},
{"role":"user","content":"Ich wünsche der Bäckerei Schmidt von ganzem Herzen alles Gute zum Jubiläum. Möge sie noch lange so familiär bleiben. Ich bin dankbar, ein Teil dieser Geschichte zu sein."}
]'::jsonb),
('FIR004', 'ANDFIR', 'Hans Petersen', 'Stammkunde', 'männlich', 'Sie', '[
{"role":"assistant","content":"Seit wann kaufen Sie schon bei Schmidt?"},
{"role":"user","content":"Ich kaufe meine Brötchen seit fast fünfzig Jahren bei der Bäckerei Schmidt. Schon mein Vater holte hier sonntags die Brötchen. Diese Bäckerei begleitet meine Familie über drei Generationen."},
{"role":"assistant","content":"Was hält Sie all die Jahre treu?"},
{"role":"user","content":"Es ist die gleichbleibende Qualität, die mich nie enttäuscht hat. Das Brot schmeckt heute noch genauso gut wie damals. Und nirgendwo wird man so freundlich bedient."},
{"role":"assistant","content":"Gibt es eine schöne Erinnerung an den Laden?"},
{"role":"user","content":"Als Kind bekam ich vom alten Herrn Schmidt immer heimlich ein Stück Kuchen geschenkt. Dieses Lächeln über der Theke vergesse ich nie. Heute schenkt sein Sohn meinen Enkeln dasselbe Lächeln."},
{"role":"assistant","content":"Was bedeutet Ihnen die Bäckerei für das Viertel?"},
{"role":"user","content":"Die Bäckerei ist der Treffpunkt unseres Viertels. Hier erfährt man die Neuigkeiten und trifft die Nachbarn. Ohne sie wäre unsere Straße um vieles ärmer."},
{"role":"assistant","content":"Was wünschen Sie der Bäckerei?"},
{"role":"user","content":"Ich wünsche der Bäckerei Schmidt noch mindestens fünfzig weitere Jahre. Mögen die Brötchen immer so knusprig bleiben. Auf dass meine Enkel hier noch lange einkaufen können."}
]'::jsonb),
('FIR005', 'ANDFIR', 'Lukas Berg', 'Auszubildender', 'männlich', 'Du', '[
{"role":"assistant","content":"Warum hast du deine Ausbildung gerade hier begonnen?"},
{"role":"user","content":"Ich wollte das Backen bei echten Profis von der Pike auf lernen. Schon beim Schnuppertag spürte ich die besondere Atmosphäre. Hier wird das Handwerk noch mit echtem Herzblut gelebt."},
{"role":"assistant","content":"Was lernst du in der Bäckerei?"},
{"role":"user","content":"Ich lerne nicht nur, wie man perfektes Brot backt. Ich lerne auch, was Verantwortung und Pünktlichkeit wirklich bedeuten. Diese Werte werden mir mein ganzes Leben helfen."},
{"role":"assistant","content":"Gibt es einen Moment, der dich geprägt hat?"},
{"role":"user","content":"Als ich mein erstes eigenes Brot ganz allein gebacken hatte, war der Chef richtig stolz. Er stellte es ganz vorne in die Auslage. Dieser Moment hat mir gezeigt, dass ich am richtigen Ort bin."},
{"role":"assistant","content":"Wie ist die Stimmung im Betrieb?"},
{"role":"user","content":"Auch wenn wir früh aufstehen müssen, wird viel gelacht. Alle helfen sich gegenseitig, egal wie viel los ist. Man fühlt sich hier wirklich wie in einer Familie."},
{"role":"assistant","content":"Was wünschst du der Bäckerei zum Jubiläum?"},
{"role":"user","content":"Ich wünsche der Bäckerei, dass sie immer so besonders bleibt. Vielleicht darf ich ja eines Tages selbst hier ausbilden. Danke, dass ich Teil dieser tollen Geschichte sein darf."}
]'::jsonb)
on conflict (id) do nothing;

-- ================================================================
-- 7) WILLKOMMENSBUCH (newborn) – Emma (Eltern: Lisa & Jan Becker)
-- ================================================================
insert into memorials (id, name, organizer, product_category, owner_user, languages, intake)
values ('ANDBAB', 'Emma', 'Andreas', 'newborn',
        (select id from app_users where lower(username) = lower('Andreas')), '{de}', '{"parents":"Lisa & Jan Becker"}'::jsonb)
on conflict (id) do nothing;

insert into contributions (id, memorial_id, contributor_name, relationship, contributor_gender, contributor_address, messages) values
('BAB001', 'ANDBAB', 'Andreas Becker', 'Opa', 'männlich', 'Du', '[
{"role":"assistant","content":"Was empfindest du, jetzt wo Emma auf der Welt ist?"},
{"role":"user","content":"Liebe Emma, als ich dich zum ersten Mal im Arm hielt, blieb mein Herz fast stehen. So viel Glück hatte ich nicht für möglich gehalten. Vom ersten Atemzug an hast du mich um den Finger gewickelt."},
{"role":"assistant","content":"Was wünschst du dir für Emmas Leben?"},
{"role":"user","content":"Ich wünsche dir, dass du immer neugierig durch die Welt gehst. Hab keine Angst, Fehler zu machen, denn aus ihnen wächst man. Und vergiss nie, dass deine Familie immer hinter dir steht."},
{"role":"assistant","content":"Was möchtest du Emma später einmal beibringen?"},
{"role":"user","content":"Ich möchte dir beibringen, wie man Drachen steigen lässt und Fische angelt. Wir werden zusammen die schönsten Plätze am Fluss entdecken. Ich kann es kaum erwarten, die Welt mit deinen Augen neu zu sehen."},
{"role":"assistant","content":"Welchen Wert möchtest du ihr mitgeben?"},
{"role":"user","content":"Sei immer ehrlich, auch wenn es manchmal schwerfällt. Ein gutes Herz ist mehr wert als aller Reichtum der Welt. Das hat mich mein Leben lang getragen, und es wird auch dich tragen."},
{"role":"assistant","content":"Was möchtest du Emma zum Schluss sagen?"},
{"role":"user","content":"Willkommen auf dieser wunderbaren Welt, meine kleine Emma. Du bist das größte Geschenk für unsere ganze Familie. Dein Opa wird immer für dich da sein."}
]'::jsonb),
('BAB002', 'ANDBAB', 'Lisa Becker', 'Mutter', 'weiblich', 'Du', '[
{"role":"assistant","content":"Wie war der Moment, als du Emma zum ersten Mal sahst?"},
{"role":"user","content":"Liebe Emma, der Moment deiner Geburt war der schönste meines Lebens. Als ich deine winzige Hand spürte, wusste ich, was bedingungslose Liebe bedeutet. Die ganze Welt schien in diesem Augenblick stillzustehen."},
{"role":"assistant","content":"Was wünschst du dir für deine Tochter?"},
{"role":"user","content":"Ich wünsche mir, dass du dein eigenes Glück findest, was immer das für dich bedeutet. Du sollst lachen können, so frei und laut du willst. Und ich wünsche dir den Mut, immer du selbst zu sein."},
{"role":"assistant","content":"Welche Werte möchtest du Emma mitgeben?"},
{"role":"user","content":"Ich möchte dir Mitgefühl für andere Menschen mitgeben. Sei freundlich zu denen, die es schwerer haben als du. Die Welt wird ein besserer Ort, wenn man sie mit dem Herzen sieht."},
{"role":"assistant","content":"Worauf freust du dich mit Emma am meisten?"},
{"role":"user","content":"Ich freue mich auf all die kleinen, alltäglichen Momente mit dir. Auf dein erstes Lachen, deine ersten Schritte, deine tausend Fragen. Jeden dieser Augenblicke will ich für immer im Herzen bewahren."},
{"role":"assistant","content":"Was möchtest du Emma sagen?"},
{"role":"user","content":"Mein kleiner Schatz, du wirst immer bedingungslos geliebt. Egal was kommt, deine Mama hält deine Hand. Danke, dass du uns zu einer Familie gemacht hast."}
]'::jsonb),
('BAB003', 'ANDBAB', 'Greta Becker', 'Oma', 'weiblich', 'Du', '[
{"role":"assistant","content":"Was bedeutet dir deine Enkelin Emma?"},
{"role":"user","content":"Liebe Emma, mit dir ist ein neues Licht in unsere Familie gekommen. Eine Großmutter zu werden ist ein Glück, das ich kaum in Worte fassen kann. Du hast mein Herz im Sturm erobert."},
{"role":"assistant","content":"Was wünschst du Emma fürs Leben?"},
{"role":"user","content":"Ich wünsche dir ein Leben voller Musik und Lachen. Möge dein Weg dich an die schönsten Orte führen. Und egal wohin er dich bringt, finde immer auch nach Hause zurück."},
{"role":"assistant","content":"Welche Familiengeschichte möchtest du Emma weitergeben?"},
{"role":"user","content":"Ich möchte dir von deiner Urgroßmutter erzählen, die so mutig war, wie du es einmal sein wirst. In unserer Familie haben die Frauen immer zusammengehalten. Du bist das jüngste Glied dieser starken Kette."},
{"role":"assistant","content":"Was möchtest du mit Emma gemeinsam erleben?"},
{"role":"user","content":"Ich möchte mit dir backen und dir alte Lieder vorsingen. Wir werden zusammen im Garten Blumen pflanzen und ihnen beim Wachsen zusehen. Ich freue mich auf jede einzelne Stunde mit dir."},
{"role":"assistant","content":"Was möchtest du Emma zum Schluss sagen?"},
{"role":"user","content":"Herzlich willkommen, meine kleine Sonne. Du bist von der ersten Sekunde an zutiefst geliebt. Deine Oma ist so unendlich froh, dass es dich gibt."}
]'::jsonb),
('BAB004', 'ANDBAB', 'Felix Becker', 'Onkel', 'männlich', 'Du', '[
{"role":"assistant","content":"Wie hast du auf die Nachricht von Emmas Geburt reagiert?"},
{"role":"user","content":"Liebe Emma, als ich erfuhr, dass du da bist, habe ich vor Freude laut gejubelt. Ich bin jetzt Onkel, und das macht mich unglaublich stolz. Sofort wollte ich dich kennenlernen."},
{"role":"assistant","content":"Was für ein Onkel möchtest du für Emma sein?"},
{"role":"user","content":"Ich möchte der Onkel sein, mit dem man die größten Abenteuer erlebt. Bei mir darfst du auch mal Quatsch machen, den die Eltern verbieten. Aber ich werde immer aufpassen, dass dir nichts passiert."},
{"role":"assistant","content":"Was wünschst du Emma?"},
{"role":"user","content":"Ich wünsche dir, dass du nie deine Abenteuerlust verlierst. Trau dich, auf Bäume zu klettern und groß zu träumen. Das Leben gehört den Mutigen, und ich weiß, du wirst mutig sein."},
{"role":"assistant","content":"Was möchtest du Emma später zeigen?"},
{"role":"user","content":"Ich möchte dir die Welt zeigen, von den Bergen bis zum Meer. Wir werden zusammen lachen, bis uns der Bauch wehtut. Onkel Felix hat schon jetzt tausend Pläne mit dir."},
{"role":"assistant","content":"Was möchtest du Emma sagen?"},
{"role":"user","content":"Willkommen in unserer verrückten, wunderbaren Familie. Du hast ab heute einen Onkel, der dich über alles liebt. Ich freue mich auf alles, was wir gemeinsam erleben werden."}
]'::jsonb),
('BAB005', 'ANDBAB', 'Marie Hoffmann', 'Freundin der Eltern', 'weiblich', 'Du', '[
{"role":"assistant","content":"Was bedeutet dir Emmas Ankunft?"},
{"role":"user","content":"Liebe Emma, deine Eltern sind meine liebsten Menschen, und nun bist du da. Deine Geburt hat auch mein Herz größer gemacht. Ich bin so dankbar, dich von Anfang an begleiten zu dürfen."},
{"role":"assistant","content":"Was wünschst du Emma für ihr Leben?"},
{"role":"user","content":"Ich wünsche dir treue Freunde, die in guten wie in schweren Zeiten bleiben. Eine echte Freundschaft ist einer der größten Schätze des Lebens. Mögest du sie früh finden und gut hüten."},
{"role":"assistant","content":"Was schätzt du an Emmas Eltern?"},
{"role":"user","content":"Deine Eltern haben so viel Liebe und Geduld in sich. Du hast wirklich das große Los gezogen, mein Schatz. Bei ihnen wirst du behütet und frei zugleich aufwachsen."},
{"role":"assistant","content":"Worauf freust du dich mit Emma?"},
{"role":"user","content":"Ich freue mich darauf, dir Geschichten vorzulesen und mit dir zu basteln. Eines Tages erzähle ich dir, wie sehr deine Eltern sich auf dich gefreut haben. Ich kann es kaum erwarten, dich wachsen zu sehen."},
{"role":"assistant","content":"Was möchtest du Emma sagen?"},
{"role":"user","content":"Willkommen auf der Welt, du kleines Wunder. Du bist in einen Kreis voller Liebe hineingeboren. Ich werde immer eine Freundin an deiner Seite sein."}
]'::jsonb)
on conflict (id) do nothing;

-- ================================================================
-- 8) MUTMACHBUCH (encouragement) – Julia Krüger
-- ================================================================
insert into memorials (id, name, organizer, gender, product_category, owner_user, languages, intake)
values ('ANDMUT', 'Julia Krüger', 'Andreas', 'weiblich', 'encouragement',
        (select id from app_users where lower(username) = lower('Andreas')), '{de}', '{}'::jsonb)
on conflict (id) do nothing;

insert into contributions (id, memorial_id, contributor_name, relationship, contributor_gender, contributor_address, messages) values
('MUT001', 'ANDMUT', 'Andreas Krüger', 'Ehemann', 'männlich', 'Du', '[
{"role":"assistant","content":"Was möchtest du Julia in dieser Zeit sagen?"},
{"role":"user","content":"Liebe Julia, ich bin an jedem einzelnen Tag an deiner Seite. Wir haben schon so viele Stürme gemeinsam überstanden und werden auch diesen meistern. Du bist die stärkste Frau, die ich kenne."},
{"role":"assistant","content":"Welche Stärke an Julia gibt dir Hoffnung?"},
{"role":"user","content":"Deine unerschütterliche Zuversicht hat mich schon oft getragen. Selbst an grauen Tagen findest du noch einen Grund zu lächeln. Diese Kraft wird auch jetzt stärker sein als alles andere."},
{"role":"assistant","content":"Gibt es eine schöne gemeinsame Erinnerung, die dir Mut macht?"},
{"role":"user","content":"Erinnerst du dich an unsere Wanderung auf den Gipfel im letzten Sommer? Du wolltest mehrmals umkehren, doch du hast durchgehalten. Oben standest du strahlend da, und genauso wirst du auch das hier schaffen."},
{"role":"assistant","content":"Worauf freust du dich mit Julia für die Zukunft?"},
{"role":"user","content":"Ich freue mich auf all die Reisen, die wir noch vor uns haben. Wir haben noch so viele Orte auf unserer Liste. Diese Träume warten auf uns, und wir werden sie gemeinsam erfüllen."},
{"role":"assistant","content":"Was möchtest du Julia mit auf den Weg geben?"},
{"role":"user","content":"Lehn dich an mich, so oft du es brauchst. Du musst nicht stark sein für mich, ich bin stark für uns beide. Ich liebe dich, heute mehr denn je."}
]'::jsonb),
('MUT002', 'ANDMUT', 'Sophie Krüger', 'Schwester', 'weiblich', 'Du', '[
{"role":"assistant","content":"Was möchtest du deiner Schwester sagen?"},
{"role":"user","content":"Liebe Julia, du bist nicht nur meine Schwester, sondern meine beste Verbündete. Seit wir Kinder sind, halten wir zusammen wie Pech und Schwefel. Auch jetzt lasse ich deine Hand nicht los."},
{"role":"assistant","content":"Welche Eigenschaft bewunderst du an Julia?"},
{"role":"user","content":"Ich bewundere deinen Mut, der mir schon als Kind imponiert hat. Du bist immer vorausgegangen, wenn ich mich nicht traute. Dieser Mut steckt tief in dir und wird dich jetzt tragen."},
{"role":"assistant","content":"Gibt es eine Erinnerung, die euch verbindet?"},
{"role":"user","content":"Weißt du noch, wie wir als Mädchen heimlich auf den Kirschbaum geklettert sind? Wir haben gelacht, bis uns die Bäuche wehtaten. Diese Leichtigkeit wünsche ich dir bald wieder zurück."},
{"role":"assistant","content":"Was wünschst du deiner Schwester?"},
{"role":"user","content":"Ich wünsche dir Kraft für jeden einzelnen Tag. Mögest du dich getragen fühlen von all den Menschen, die dich lieben. Und ich wünsche dir bald wieder dein altes, lautes Lachen."},
{"role":"assistant","content":"Was möchtest du Julia versprechen?"},
{"role":"user","content":"Ich verspreche dir, dass ich immer nur einen Anruf entfernt bin. Egal wann, egal warum, ich bin sofort bei dir. Wir gehen diesen Weg zusammen, Schwesterherz."}
]'::jsonb),
('MUT003', 'ANDMUT', 'Nina Wagner', 'beste Freundin', 'weiblich', 'Du', '[
{"role":"assistant","content":"Was möchtest du Julia in dieser Zeit sagen?"},
{"role":"user","content":"Liebe Julia, seit zwanzig Jahren bist du meine beste Freundin. Du warst bei jedem Tief an meiner Seite, jetzt bin ich bei deinem. Gemeinsam sind wir unschlagbar, das waren wir immer."},
{"role":"assistant","content":"Welche Stärke an Julia macht dir Mut?"},
{"role":"user","content":"Du hast die Gabe, anderen Menschen Kraft zu schenken, selbst wenn es dir schlecht geht. Genau diese Kraft schicke ich dir jetzt tausendfach zurück. Du bist stärker, als du gerade glaubst."},
{"role":"assistant","content":"Gibt es eine Erinnerung, die euch Mut gibt?"},
{"role":"user","content":"Weißt du noch, unser spontaner Roadtrip ans Meer ohne Plan? Wir haben im Auto geschlafen und uns königlich amüsiert. So ein Abenteuer holen wir bald nach, das verspreche ich dir."},
{"role":"assistant","content":"Was wünschst du deiner Freundin?"},
{"role":"user","content":"Ich wünsche dir Tage voller kleiner Lichtblicke. Mögest du spüren, wie sehr du geliebt wirst. Und ich wünsche mir so sehr, bald wieder mit dir zu lachen."},
{"role":"assistant","content":"Was möchtest du Julia versprechen?"},
{"role":"user","content":"Ich verspreche dir, dass ich nicht von deiner Seite weiche. Wir trinken bald wieder zusammen Kaffee und reden über alles. Du bist nicht allein, niemals."}
]'::jsonb),
('MUT004', 'ANDMUT', 'Thomas Berg', 'Kollege', 'männlich', 'Du', '[
{"role":"assistant","content":"Was möchtest du deiner Kollegin Julia sagen?"},
{"role":"user","content":"Liebe Julia, das ganze Team denkt jeden Tag an dich. Du fehlst uns mit deiner guten Laune an allen Ecken. Wir können es kaum erwarten, dich wieder bei uns zu haben."},
{"role":"assistant","content":"Was schätzt du an Julia als Kollegin?"},
{"role":"user","content":"Du bist diejenige, die immer für gute Stimmung sorgt. Selbst an stressigen Tagen bringst du uns zum Lachen. Diese Wärme vermissen wir gerade sehr."},
{"role":"assistant","content":"Gibt es eine Geschichte aus dem Arbeitsalltag, die dich an sie denken lässt?"},
{"role":"user","content":"Ich denke oft an die Projektnacht, in der alles schiefging. Du hast uns mit einem Witz und Pizza gerettet. Genau diese Stärke wirst du jetzt für dich selbst nutzen."},
{"role":"assistant","content":"Was wünschst du Julia?"},
{"role":"user","content":"Ich wünsche dir vor allem viel Kraft und Geduld mit dir selbst. Lass dir alle Zeit, die du brauchst. Wir halten dir hier den Rücken frei."},
{"role":"assistant","content":"Was möchtest du Julia mitgeben?"},
{"role":"user","content":"Denk daran, dass du nicht allein kämpfst. Hinter dir steht ein ganzes Team voller Menschen, die dich mögen. Wir freuen uns auf den Tag deiner Rückkehr."}
]'::jsonb),
('MUT005', 'ANDMUT', 'Liselotte Krüger', 'Großmutter', 'weiblich', 'Du', '[
{"role":"assistant","content":"Was möchtest du deiner Enkelin sagen?"},
{"role":"user","content":"Mein liebes Julchen, deine Oma betet jeden Tag für dich. Ich habe in meinem langen Leben gelernt, dass nach jedem Winter ein Frühling kommt. Auch für dich wird die Sonne wieder scheinen."},
{"role":"assistant","content":"Welche Stärke siehst du in Julia?"},
{"role":"user","content":"Du hast das starke Herz deiner Großmutter geerbt. Schon als kleines Mädchen hast du nie so schnell aufgegeben. Diese Kraft sitzt tief in dir, verlass dich darauf."},
{"role":"assistant","content":"Gibt es eine Erinnerung, die dir Hoffnung gibt?"},
{"role":"user","content":"Ich denke an die Sommer, in denen du bei mir auf dem Land warst. Du bist barfuß über die Wiesen gelaufen, voller Lebensfreude. Dieses Mädchen steckt noch immer in dir."},
{"role":"assistant","content":"Was wünschst du deiner Enkelin?"},
{"role":"user","content":"Ich wünsche dir Gesundheit und einen Engel, der über dich wacht. Mögest du jeden Morgen ein kleines bisschen Kraft mehr spüren. Und ich wünsche mir, dich bald wieder in die Arme zu schließen."},
{"role":"assistant","content":"Was möchtest du Julia mitgeben?"},
{"role":"user","content":"Vergiss nie, wie sehr deine Oma dich liebt. Du bist mein größter Stolz und meine größte Freude. Ich bin sicher, dass du auch das schaffen wirst, mein Kind."}
]'::jsonb)
on conflict (id) do nothing;

commit;

-- ================================================================
-- Ende. 8 Bücher (memorials) + 40 Beitragende (contributions),
-- je 5 Frage/Antwort-Paare. Codes: ANDMEM, ANDGEB, ANDHOC, ANDABS,
-- ANDDIE, ANDFIR, ANDBAB, ANDMUT.
-- ================================================================
