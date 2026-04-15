package bot;

import net.dv8tion.jda.api.entities.MessageEmbed;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.entities.emoji.Emoji;
import net.dv8tion.jda.api.events.interaction.command.CommandAutoCompleteInteractionEvent;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.events.interaction.component.ButtonInteractionEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import net.dv8tion.jda.api.interactions.commands.Command;
import net.dv8tion.jda.api.interactions.commands.OptionMapping;
import net.dv8tion.jda.api.interactions.components.ActionRow;
import net.dv8tion.jda.api.interactions.components.buttons.Button;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.awt.Color;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class Monster extends ListenerAdapter {

    private final String[] monsterList = { "레 다우", "우드 투나", "누 이그드라", "진 다하드", "리오레우스", "조 시아", "알슈베르도", "고어 마가라",
            "타마미츠네", "라기아크루스", "셀레기오스", "오메가 플라네테스", "고그마지오스", "고양이 훈련 통 펀처"};

    private final Map<String, List<String>> monsterAliases = new HashMap<>();

    public Monster() {
        monsterAliases.put("레 다우", Arrays.asList("레다우", "레", "레황", "황뢰룡"));
        monsterAliases.put("우드 투나", Arrays.asList("우드", "우드투나", "참치", "나무참치", "나무 참치", "파의룡"));
        monsterAliases.put("누 이그드라", Arrays.asList("누", "누이그드라", "누따끄", "마따끄", "문어", "염옥소"));
        monsterAliases.put("진 다하드", Arrays.asList("찐따", "진다", "진다하드", "찐따하드", "이긴다 소프트", "동봉룡"));
        monsterAliases.put("리오레우스", Arrays.asList("레우스", "리오", "화룡"));
        monsterAliases.put("조 시아", Arrays.asList("바퀴벌레", "조시아", "백열룡"));
        monsterAliases.put("고어 마가라", Arrays.asList("고어마가라", "고어", "마가라", "고아", "흑식룡"));
        monsterAliases.put("알슈베르도", Arrays.asList("알슈", "뉴트리아", "나타", "쇄인룡"));
        monsterAliases.put("타마미츠네", Arrays.asList("타마", "미츠네", "여우", "거품", "포호룡"));
        monsterAliases.put("라기아크루스", Arrays.asList("라기", "라기아", "악어", "수중전", "해룡"));
        monsterAliases.put("셀레기오스", Arrays.asList("셀레기", "제트킥", "째트킥", "셀레", "칼날비늘", "천인룡"));
        monsterAliases.put("오메가 플라네테스", Arrays.asList("오메가", "파판", "파이널판타지", "파이널 판타지", "기계", "메카", "풍뎅이", "메카풍뎅이", "병신"));
        monsterAliases.put("고그마지오스", Arrays.asList("고그마", "고구마", "거극룡", "거극", "파룡포", "기름"));
        monsterAliases.put("고양이 훈련 통 펀처", Arrays.asList("펀처", "고양이 훈련 통", "훈련 통 펀처", "연습장", "연습", "훈련", "수련장", "수련"));
    }

    // 💡 문자열에서 공백을 모두 제거하고 소문자로 변환 (검색 성능 향상)
    private String normalize(String str) {
        return str.replace(" ", "").toLowerCase();
    }

    private String resolveMonsterName(String input) {
        String normalizedInput = normalize(input);
        
        // 1. 공식 이름에서 공백 무시하고 찾기
        for (String official : monsterList) {
            if (normalize(official).equals(normalizedInput)) return official;
        }
        
        // 2. 별명 목록에서 공백 무시하고 찾기
        for (Map.Entry<String, List<String>> entry : monsterAliases.entrySet()) {
            for (String alias : entry.getValue()) {
                if (normalize(alias).equals(normalizedInput)) return entry.getKey();
            }
        }
        return input;
    }

    private String getArrayAsString(JsonObject data, String key) {
        if (!data.has(key)) return "정보가 없습니다.";
        if (data.get(key).isJsonArray()) {
            List<String> lines = new ArrayList<>();
            data.getAsJsonArray(key).forEach(element -> lines.add(element.getAsString()));
            return String.join("\n", lines);
        }
        return data.get(key).getAsString();
    }

    @Override
    public void onCommandAutoCompleteInteraction(CommandAutoCompleteInteractionEvent event) {
        if (event.getName().equals("몬스터") && event.getFocusedOption().getName().equals("이름")) {
            String currentInput = normalize(event.getFocusedOption().getValue().trim());
            List<Command.Choice> options = new ArrayList<>();
            
            for (String officialName : monsterList) {
                boolean isMatch = normalize(officialName).contains(currentInput);
                
                // 공식 이름에 없으면 별명 목록 뒤지기
                if (!isMatch && monsterAliases.containsKey(officialName)) {
                    for (String alias : monsterAliases.get(officialName)) {
                        if (normalize(alias).contains(currentInput)) {
                            isMatch = true;
                            break;
                        }
                    }
                }
                
                if (isMatch) {
                    options.add(new Command.Choice(officialName, officialName));
                    if (options.size() >= 25) break;
                }
            }
            event.replyChoices(options).queue();
        }
    }

    private JsonObject getMonsterData(String monsterName) {
        try {
            // resolveMonsterName을 통해 반환된 '공식 이름'이 파일명과 정확히 일치해야 함
            String fileName = monsterName + ".json";
            InputStream is = getClass().getClassLoader().getResourceAsStream(fileName);
            if (is == null) return null;
            return JsonParser.parseReader(new InputStreamReader(is, StandardCharsets.UTF_8)).getAsJsonObject();
        } catch (Exception e) {
            return null;
        }
    }

    private List<Button> getTabButtons(String currentTab, String monsterName, JsonObject monsterData) {
        List<Button> buttons = new ArrayList<>();
        if (!currentTab.equals("basic") && monsterData.has("info"))
            buttons.add(Button.secondary("basic_" + monsterName, "기본 정보").withEmoji(Emoji.fromFormatted("<:Info_4:1492145251941482697>")));
        if (!currentTab.equals("hitzone") && monsterData.has("hitzone"))
            buttons.add(Button.primary("hitzone_" + monsterName, "육질 정보").withEmoji(Emoji.fromFormatted("<:Info_2:1492145248795758602>")));
        if (!currentTab.equals("drop") && (monsterData.has("drop") || monsterData.has("drop_low") || monsterData.has("drop_high")))
            buttons.add(Button.success("drop_" + monsterName, "소재 정보").withEmoji(Emoji.fromFormatted("<:Info_1:1492145247327617185>")));
        if (!currentTab.equals("status") && monsterData.has("status"))
            buttons.add(Button.danger("status_" + monsterName, "상태이상 정보").withEmoji(Emoji.fromFormatted("<:Info_3:1492145250192331015>")));
        return buttons;
    }

    @Override
    public void onSlashCommandInteraction(SlashCommandInteractionEvent event) {
        if (event.getName().equals("몬스터")) {
            OptionMapping option = event.getOption("이름");
            if (option == null) return;
            
            String userInput = option.getAsString().trim();
            String monsterName = resolveMonsterName(userInput); // 💡 여기서 별칭을 공식 이름으로 변환
            JsonObject monsterData = getMonsterData(monsterName);
            
            if (monsterData == null) {
                event.reply("<:X_:1493987174750748812> 데이터 없음: `" + userInput + "`").queue();
                return;
            }
            
            if (!monsterData.has("info") && monsterData.has("hitzone")) {
                sendHitzonePage(event, null, monsterName, monsterData, false);
            } else {
                sendBasicPage(event, null, monsterName, monsterData, false);
            }
        }
    }

    @Override
    public void onButtonInteraction(ButtonInteractionEvent event) {
        String[] parts = event.getComponentId().split("_");
        if (parts.length < 2) return;

        String action = parts[0];
        String monsterName = parts[1];
        JsonObject monsterData = getMonsterData(monsterName);
        if (monsterData == null) return;

        EmbedBuilder embed = new EmbedBuilder();
        try {
            if (monsterData.has("color")) embed.setColor(Color.decode(monsterData.get("color").getAsString()));
            else embed.setColor(new Color(255, 255, 255));
        } catch (Exception e) { embed.setColor(new Color(255, 255, 255)); }

        if (monsterData.has("thumbnail")) embed.setThumbnail(monsterData.get("thumbnail").getAsString());
        String icon = monsterData.has("icon") ? monsterData.get("icon").getAsString() + " " : "";
        String titleText = "# " + icon + monsterName + "\n";

        switch (action) {
            case "basic":
                sendBasicPage(null, event, monsterName, monsterData, true);
                return;
            case "hitzone":
                sendHitzonePage(null, event, monsterName, monsterData, true);
                return;
            case "drop":
            case "dropLow":
            case "dropHigh":
                boolean hasRankInfo = monsterData.has("drop_low");
                String dataKey = hasRankInfo ? (action.equals("dropHigh") ? "drop_high" : "drop_low") : "drop";
                List<MessageEmbed> dropEmbeds = splitTextToEmbeds(embed, titleText + "\n" + getArrayAsString(monsterData, dataKey));
                List<ActionRow> rows = new ArrayList<>();
                if (hasRankInfo) {
                    rows.add(ActionRow.of(
                        Button.success("dropLow_" + monsterName, "《 하위 》").withEmoji(Emoji.fromFormatted("<:Rank_3:1492424259262222356>")), 
                        Button.success("dropHigh_" + monsterName, "《 상위 》").withEmoji(Emoji.fromFormatted("<:Rank_4:1492424261032214589>"))
                    ));
                }
                List<Button> dropButtons = getTabButtons("drop", monsterName, monsterData);
                if (!dropButtons.isEmpty()) rows.add(ActionRow.of(dropButtons));
                if (rows.isEmpty()) event.editMessageEmbeds(dropEmbeds).setComponents().queue();
                else event.editMessageEmbeds(dropEmbeds).setComponents(rows).queue();
                return;
            case "status":
                StringBuilder statusDesc = new StringBuilder(titleText + "\n");
                if (monsterData.has("status")) {
                    List<String> s3 = new ArrayList<>(), s2 = new ArrayList<>(), s1 = new ArrayList<>(), s0 = new ArrayList<>();
                    monsterData.getAsJsonArray("status").forEach(el -> {
                        String s = el.getAsString();
                        String clean = "> " + s.replaceAll("[　\\s]*\\(.*?\\)", "").trim();
                        if (s.contains("<:Star_3:1493987178642935941>")) s3.add(clean);
                        else if (s.contains("<:Star_2:1493987181176426629>")) s2.add(clean);
                        else if (s.contains("<:Star_1:1493987182992691280>")) s1.add(clean);
                        else s0.add(clean);
                    });
                    if (!s3.isEmpty()) statusDesc.append("**《 <:Star_3:1493987178642935941> 매우 유효 》**\n").append(String.join("\n", s3)).append("\n\n");
                    if (!s2.isEmpty()) statusDesc.append("**《 <:Star_2:1493987181176426629> 유효 》**\n").append(String.join("\n", s2)).append("\n\n");
                    if (!s1.isEmpty()) statusDesc.append("**《 <:Star_1:1493987182992691280> 조금 유효 》**\n").append(String.join("\n", s1)).append("\n\n");
                    if (!s0.isEmpty()) statusDesc.append("**《 <:X_:1493987174750748812> 효과 없음 》**\n").append(String.join("\n", s0)).append("\n\n");
                }
                if (monsterData.has("special_attack")) {
                    statusDesc.append("**《 몬스터의 특수 공격 》**\n");
                    monsterData.getAsJsonArray("special_attack").forEach(el -> statusDesc.append("> ").append(el.getAsString()).append("\n"));
                    statusDesc.append("\n");
                }
                if (monsterData.has("item")) {
                    List<String> valid = new ArrayList<>(), invalid = new ArrayList<>();
                    monsterData.getAsJsonArray("item").forEach(el -> {
                        String s = el.getAsString();
                        String clean = "> " + s.replaceAll("[　\\s]*\\(.*?\\)", "").trim();
                        if (s.contains("<:Check:1493987173194661919>")) valid.add(clean); else if (s.contains("<:X_:1493987174750748812>")) invalid.add(clean); else valid.add(clean);
                    });
                    if (!valid.isEmpty()) statusDesc.append("**《 <:Check:1493987173194661919> 유효 아이템 》**\n").append(String.join("\n", valid)).append("\n\n");
                    if (!invalid.isEmpty()) statusDesc.append("**《 <:X_:1493987174750748812> 무효 아이템 》**\n").append(String.join("\n", invalid)).append("\n\n");
                }
                event.editMessageEmbeds(splitTextToEmbeds(embed, statusDesc.toString().trim()))
                     .setActionRow(getTabButtons("status", monsterName, monsterData)).queue();
                return;
        }
        event.editMessageEmbeds(embed.build()).setActionRow(getTabButtons(action, monsterName, monsterData)).queue();
    }

    private void sendHitzonePage(SlashCommandInteractionEvent slashEvent, ButtonInteractionEvent buttonEvent,
            String monsterName, JsonObject monsterData, boolean isEdit) {
        EmbedBuilder eb = new EmbedBuilder();
        try { if (monsterData.has("color")) eb.setColor(Color.decode(monsterData.get("color").getAsString())); } catch (Exception e) {}
        if (monsterData.has("thumbnail")) eb.setThumbnail(monsterData.get("thumbnail").getAsString());
        String icon = monsterData.has("icon") ? monsterData.get("icon").getAsString() + " " : "";
        String title = "# " + icon + monsterName + "\n";
        List<MessageEmbed> embeds = splitTextToEmbeds(eb, title + getArrayAsString(monsterData, "hitzone"));
        List<Button> btns = getTabButtons("hitzone", monsterName, monsterData);
        if (isEdit) { if (btns.isEmpty()) buttonEvent.editMessageEmbeds(embeds).setComponents().queue(); else buttonEvent.editMessageEmbeds(embeds).setActionRow(btns).queue(); }
        else { if (btns.isEmpty()) slashEvent.replyEmbeds(embeds).queue(); else slashEvent.replyEmbeds(embeds).addActionRow(btns).queue(); }
    }

    private void sendBasicPage(SlashCommandInteractionEvent slashEvent, ButtonInteractionEvent buttonEvent,
            String monsterName, JsonObject monsterData, boolean isEdit) {
        EmbedBuilder eb = new EmbedBuilder();
        try { if (monsterData.has("color")) eb.setColor(Color.decode(monsterData.get("color").getAsString())); } catch (Exception e) {}
        if (monsterData.has("thumbnail")) eb.setThumbnail(monsterData.get("thumbnail").getAsString());
        String icon = monsterData.has("icon") ? monsterData.get("icon").getAsString() + " " : "";
        StringBuilder sb = new StringBuilder("# ").append(icon).append(monsterName).append("\n");
        if (monsterData.has("species")) sb.append("**【 ").append(monsterData.get("species").getAsString()).append(" 】**\n\n");
        sb.append(getArrayAsString(monsterData, "info")).append("\n\n");
        if (monsterData.has("habitat")) sb.append("**《 서식지 》**\n> ").append(monsterData.get("habitat").getAsString()).append("\n\n");
        if (monsterData.has("threat_level")) sb.append("**《 위험도 》**\n> ").append(monsterData.get("threat_level").getAsString()).append("\n\n");
        String[] keys = {"breakable_parts", "weak_point", "element_weakness"};
        String[] titles = {"**《 파괴 가능 부위 》**", "**《 약점 》**", "**《 추천 속성 》**"};
        for (int i=0; i<3; i++) {
            if (monsterData.has(keys[i])) {
                sb.append(titles[i]).append("\n");
                monsterData.getAsJsonArray(keys[i]).forEach(el -> sb.append("> ").append(el.getAsString().replace("\n","").trim()).append("\n"));
                sb.append("\n");
            }
        }
        eb.setDescription(sb.toString().trim());
        List<Button> btns = getTabButtons("basic", monsterName, monsterData);
        if (isEdit) { if (btns.isEmpty()) buttonEvent.editMessageEmbeds(eb.build()).setComponents().queue(); else buttonEvent.editMessageEmbeds(eb.build()).setActionRow(btns).queue(); }
        else { if (btns.isEmpty()) slashEvent.replyEmbeds(eb.build()).queue(); else slashEvent.replyEmbeds(eb.build()).addActionRow(btns).queue(); }
    }

    private List<MessageEmbed> splitTextToEmbeds(EmbedBuilder baseEmbed, String fullText) {
        List<MessageEmbed> embeds = new ArrayList<>();
        int maxLength = 1800;
        if (fullText.length() <= maxLength) { baseEmbed.setDescription(fullText); embeds.add(baseEmbed.build()); return embeds; }
        String rem = fullText; boolean first = true;
        while (rem.length() > 0) {
            if (rem.length() <= maxLength) { EmbedBuilder eb = new EmbedBuilder(baseEmbed).setDescription(rem); if (!first) eb.setThumbnail(null); embeds.add(eb.build()); break; }
            int idx = rem.lastIndexOf("\n\n", maxLength);
            if (idx == -1 || idx < maxLength - 800) { int alt = rem.lastIndexOf("\n**", maxLength); if (alt > idx) idx = alt; }
            if (idx == -1) idx = rem.lastIndexOf("\n", maxLength);
            if (idx == -1) idx = maxLength;
            EmbedBuilder eb = new EmbedBuilder(baseEmbed).setDescription(rem.substring(0, idx).trim()); if (!first) eb.setThumbnail(null);
            embeds.add(eb.build()); rem = rem.substring(idx).trim(); first = false;
        }
        return embeds;
    }
}